import { KraHttpClient, KraHttpRequestOptions } from '../client/KraHttpClient';
import { KraError, KraErrorCode } from '../errors';

export interface DwrSessionIds {
	scriptSessionId: string;
	windowName: string;
}

export interface DwrCallProcResult {
	errorCd?: string;
	errorDesc?: string;
	errorMsg?: string;
	isFirstRet?: string;
	isFirstRtnAfterRollOut?: string;
	updateRolloutdate?: string;
	txtPeriodFrom?: string;
	txtPeriodTo?: string;
	trpFromDt?: string;
	trpToDt?: string;
	[key: string]: unknown;
}

/**
 * Minimal DWR (Direct Web Remoting) client for KRA's portal.
 *
 * KRA uses DWR for AJAX calls such as the first-return rollout confirmation
 * (`FetchTrpDtls.callProcAjax`). The HTTP filing engine must replay these
 * calls so that server-side session state matches what the HTML form expects.
 */
export class DwrService {
	private client: KraHttpClient;
	private batchId = 0;

	constructor(client: KraHttpClient) {
		this.client = client;
	}

	/**
	 * Register a page load with DWR and obtain a fresh scriptSessionId/windowName pair.
	 */
	async pageLoaded(page: string, windowName = '', scriptSessionId = ''): Promise<DwrSessionIds> {
		const body = this.buildRequestBody({
			callCount: '1',
			windowName,
			'c0-scriptName': '__System',
			'c0-methodName': 'pageLoaded',
			'c0-id': '0',
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId,
		});

		const response = await this.postRaw('dwr/call/plaincall/__System.pageLoaded.dwr', body);
		return this.parsePageLoadedResponse(response);
	}

	/**
	 * Call FetchTrpDtls.callProcAjax, which KRA invokes from the nil-return page
	 * when the period-from field changes. For first returns after rollout it
	 * returns errorCd=4002 and isFirstRtnAfterRollOut=Y.
	 */
	async callProcAjax(options: {
		kraPin: string;
		obligationId: string;
		periodFrom: string;
		returnType?: string;
		branchType?: string | null;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<DwrCallProcResult> {
		const returnType = options.returnType ?? 'Original';
		const branchType = options.branchType ?? null;
		const page = options.page ?? '/KRA-Portal/eReturns.htm?actionCode=initPage';

		// KRA DWR serializes the DTO with referenced primitive parameters.
		const encodedPeriodFrom = encodeURIComponent(options.periodFrom);
		const param1 =
			'Object_Object:{' +
			[
				'obligationId:reference:c0-e1',
				'taxpayerPin:reference:c0-e2',
				'txtPeriodFrom:reference:c0-e3',
				'cmbReturnType:reference:c0-e4',
				'cmbBrnchType:reference:c0-e5',
			].join(', ') +
			'}';

		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchTrpDtls',
			'c0-methodName': 'callProcAjax',
			'c0-id': '0',
			'c0-param0': 'boolean:false',
			'c0-e1': `string:${options.obligationId}`,
			'c0-e2': `string:${options.kraPin}`,
			'c0-e3': `string:${encodedPeriodFrom}`,
			'c0-e4': `string:${returnType}`,
			'c0-e5': branchType === null ? 'null:null' : `string:${branchType}`,
			'c0-param1': param1,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});

		const response = await this.postRaw('dwr/call/plaincall/FetchTrpDtls.callProcAjax.dwr', body);
		return this.parseCallProcResponse(response);
	}

	private buildRequestBody(fields: Record<string, string>): string {
		const parts: string[] = [];
		for (const [key, value] of Object.entries(fields)) {
			parts.push(`${key}=${value}`);
		}
		return parts.join('\n');
	}

	private async postRaw(path: string, rawBody: string, options?: KraHttpRequestOptions): Promise<string> {
		return this.client.postRaw(path, rawBody, {
			...options,
			headers: {
				'Content-Type': 'text/plain',
				Origin: 'https://itax.kra.go.ke',
				Referer: 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=initPage',
				...options?.headers,
			},
		});
	}

	private parsePageLoadedResponse(response: string): DwrSessionIds {
		const scriptSessionMatch = response.match(/handleNewScriptSession\("([^"]+)"\)/);
		const windowNameMatch = response.match(/handleNewWindowName\("([^"]+)"\)/);

		if (!scriptSessionMatch || !windowNameMatch) {
			throw new KraError(
				KraErrorCode.UNKNOWN,
				'DWR pageLoaded response did not contain session identifiers',
				{ rawResponse: response.slice(0, 2000) }
			);
		}

		return {
			scriptSessionId: scriptSessionMatch[1],
			windowName: windowNameMatch[1],
		};
	}

	private parseCallProcResponse(response: string): DwrCallProcResult {
		// Extract the third argument of dwr.engine.remote.handleCallback("1","0",{...});
		const match = response.match(/dwr\.engine\.remote\.handleCallback\("\d+","\d+",([\s\S]+?)\);\s*$/m);
		if (!match) {
			throw new KraError(
				KraErrorCode.UNKNOWN,
				'DWR callProcAjax response did not contain a callback payload',
				{ rawResponse: response.slice(0, 2000) }
			);
		}

		const objectText = match[1].trim();
		const result: DwrCallProcResult = {};

		// Parse the fields we care about. DWR returns a JavaScript object literal
		// with possible new Date(...) values; we avoid a full eval for safety.
		const extractString = (name: string): string | undefined => {
			const re = new RegExp(`${name}:"([^"]*)"`, 'i');
			const m = objectText.match(re);
			return m ? m[1] : undefined;
		};

		result.errorCd = extractString('errorCd');
		result.errorDesc = extractString('errorDesc');
		result.errorMsg = extractString('errorMsg');
		result.isFirstRet = extractString('isFirstRet');
		result.isFirstRtnAfterRollOut = extractString('isFirstRtnAfterRollOut');
		result.updateRolloutdate = extractString('updateRolloutdate');
		result.txtPeriodFrom = extractString('txtPeriodFrom');
		result.txtPeriodTo = extractString('txtPeriodTo');

		return result;
	}

	// --------------------------------------------------------------------------
	// PRN (Payment Registration) DWR helpers
	// --------------------------------------------------------------------------

	async fetchTaxPayerDetail(options: {
		kraPin: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchTaxPayerDetail',
			'c0-methodName': 'fetchTaxPayerDetail',
			'c0-id': '0',
			'c0-param0': `string:${options.kraPin}`,
			'c0-param1': `string:${options.kraPin}`,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/FetchTaxPayerDetail.fetchTaxPayerDetail.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	async fetchTaxpayerDetailWithoutValidation(options: {
		kraPin: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchTaxpayerDetailWithoutValidation',
			'c0-methodName': 'fetchTaxpayerDetailWithoutValidation',
			'c0-id': '0',
			'c0-param0': `string:${options.kraPin}`,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/FetchTaxpayerDetailWithoutValidation.fetchTaxpayerDetailWithoutValidation.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	async getObligationRollOutDateDtls(options: {
		subHeadId: string;
		taxPayerId: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'GetObligationRollOutDateDtls',
			'c0-methodName': 'getObligationRollOutDateDtls',
			'c0-id': '0',
			'c0-param0': `string:${options.subHeadId}`,
			'c0-param1': `string:${options.taxPayerId}`,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/GetObligationRollOutDateDtls.getObligationRollOutDateDtls.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	async fetchTaxPeriod(options: {
		subHeadId: string;
		taxPayerId: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
		returnType?: string;
		paymentType?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchTaxPeriod',
			'c0-methodName': 'fetchTaxPeriod',
			'c0-id': '0',
			'c0-param0': `string:${options.subHeadId}`,
			'c0-param1': `string:${options.taxPayerId}`,
			'c0-param2': `string:${options.returnType ?? 'RTN'}`,
			'c0-param3': 'string:0',
			'c0-param4': `string:${options.paymentType ?? 'SAT'}`,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/FetchTaxPeriod.fetchTaxPeriod.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	async fetchTotalLiabilityDetailsWeb(options: {
		taxPayerId: string;
		subHeadId: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
		paymentType?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchTotalLiabilityDetailsWeb',
			'c0-methodName': 'fetchTotalLiabilityDetailsWeb',
			'c0-id': '0',
			'c0-param0': `string:${options.taxPayerId}`,
			'c0-param1': `string:${options.subHeadId}`,
			'c0-param2': 'string:0',
			'c0-param3': `string:${options.paymentType ?? 'SAT'}`,
			'c0-param4': 'string:0',
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/FetchTotalLiabilityDetailsWeb.fetchTotalLiabilityDetailsWeb.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	async fetchObligationDetail(options: {
		taxPayerId: string;
		subHeadId: string;
		periodFrom: string;
		periodTo: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const fromDate = encodeURIComponent(options.periodFrom);
		const toDate = encodeURIComponent(options.periodTo);
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchObligationDetail',
			'c0-methodName': 'fetchObligationDetail',
			'c0-id': '0',
			'c0-param0': `string:${options.taxPayerId}`,
			'c0-param1': `string:${options.subHeadId}`,
			'c0-param2': `string:${fromDate}`,
			'c0-param3': `string:${toDate}`,
			'c0-param4': 'null:null',
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/FetchObligationDetail.fetchObligationDetail.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	async getSelectedMonthOfSelectedYearWeb(options: {
		date: string;
		subHeadId: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm';
		const encodedDate = encodeURIComponent(options.date);
		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'GetSelectedMonthOfSelectedYearWeb',
			'c0-methodName': 'getSelectedMonthOfSelectedYearWeb',
			'c0-id': '0',
			'c0-param0': `string:${encodedDate}`,
			'c0-param1': 'string:',
			'c0-param2': 'string:false',
			'c0-param3': `string:${options.subHeadId}`,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});
		return this.postRaw('dwr/call/plaincall/GetSelectedMonthOfSelectedYearWeb.getSelectedMonthOfSelectedYearWeb.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}

	/**
	 * Fetch MRI property details via DWR. This is called by the browser's
	 * fetchDataForMRIReturnsAjax() after the form loads and after the user
	 * enters the rental income. The response contains property records with
	 * landId and rengId that are required in the hidPropertyDetailList form field.
	 */
	async fetchDataForMRIReturnsAjax(options: {
		kraPin: string;
		periodFrom: string;
		periodTo: string;
		returnType?: string;
		totNumofPropt?: string;
		totRentalInc: string;
		taxOnRentInc: string;
		rentwhtCreditd?: string;
		crdSelfAssesPmt?: string;
		taxDue: string;
		taxpayerId: string;
		windowName: string;
		scriptSessionId: string;
		page?: string;
	}): Promise<string> {
		const page = options.page ?? '/KRA-Portal/eReturns.htm?actionCode=initPage';
		const returnType = options.returnType ?? 'Original';
		const totNumofPropt = options.totNumofPropt ?? '1';
		const rentwhtCreditd = options.rentwhtCreditd ?? '0.00';
		const crdSelfAssesPmt = options.crdSelfAssesPmt ?? '0.00';

		const encodedPeriodFrom = encodeURIComponent(options.periodFrom);
		const encodedPeriodTo = encodeURIComponent(options.periodTo);

		const param1 =
			'Object_Object:{' +
			[
				'taxpayerPin:reference:c0-e1',
				'txtPeriodFrom:reference:c0-e2',
				'txtPeriodTo:reference:c0-e3',
				'cmbReturnType:reference:c0-e4',
				'totNumofPropt:reference:c0-e5',
				'totRentalInc:reference:c0-e6',
				'taxOnRentInc:reference:c0-e7',
				'rentwhtCreditd:reference:c0-e8',
				'crdSelfAssesPmt:reference:c0-e9',
				'taxDue:reference:c0-e10',
				'taxpayerId:reference:c0-e11',
			].join(', ') +
			'}';

		const body = this.buildRequestBody({
			callCount: '1',
			windowName: options.windowName,
			'c0-scriptName': 'FetchTrpDtls',
			'c0-methodName': 'fetchDataForMRIReturnsAjax',
			'c0-id': '0',
			'c0-param0': 'boolean:false',
			'c0-e1': `string:${options.kraPin}`,
			'c0-e2': `string:${encodedPeriodFrom}`,
			'c0-e3': `string:${encodedPeriodTo}`,
			'c0-e4': `string:${returnType}`,
			'c0-e5': `string:${totNumofPropt}`,
			'c0-e6': `string:${options.totRentalInc}`,
			'c0-e7': `string:${options.taxOnRentInc}`,
			'c0-e8': `string:${rentwhtCreditd}`,
			'c0-e9': `string:${crdSelfAssesPmt}`,
			'c0-e10': `string:${options.taxDue}`,
			'c0-e11': `string:${options.taxpayerId}`,
			'c0-param1': param1,
			batchId: String(this.batchId++),
			page,
			httpSessionId: '',
			scriptSessionId: options.scriptSessionId,
		});

		return this.postRaw('dwr/call/plaincall/FetchTrpDtls.fetchDataForMRIReturnsAjax.dwr', body, {
			headers: { Referer: `https://itax.kra.go.ke${page}` },
		});
	}
}
