import React, { useState, useCallback, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { apiFetchJson } from '../services/api';
import ToggleSwitch from './ToggleSwitch';
import FilingStepTimeline from './FilingStepTimeline';
import { CheckCircle2, AlertCircle, Receipt } from 'lucide-react';
import {
    FilingFormData,
    FilingResponse,
    FilingStepLog,
    FilingStatusResponse,
    TAX_OBLIGATION_OPTIONS,
    TaxObligationType,
} from '../types';

const NIL_FILING_OPTIONS = TAX_OBLIGATION_OPTIONS.filter((option) => option.filingMode === 'nil');
const TRANSACTION_FILING_OPTIONS = TAX_OBLIGATION_OPTIONS.filter((option) => option.filingMode === 'transactional');

// ─── Toast ───────────────────────────────────────────────────────────────────

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error';
}

function useToasts() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, type: Toast['type']) => {
        const id = Date.now();
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 6_000);
    }, []);

    return { toasts, addToast };
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const DocumentIcon: React.FC = () => (
    <svg
        className="w-8 h-8 text-blue-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
    </svg>
);

const LockIcon: React.FC = () => (
    <svg
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
    </svg>
);

const SpinnerIcon: React.FC = () => (
    <svg
        className="animate-spin h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
    >
        <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
        />
        <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
    </svg>
);

// ─── Field Error ─────────────────────────────────────────────────────────────

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
    message ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
            {message}
        </p>
    ) : null;

// ─── Shared Input Class ───────────────────────────────────────────────────────

function inputCls(hasError: boolean) {
    return [
        'w-full px-3 py-2 border rounded-lg text-sm',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
        'transition-colors duration-150',
        hasError
            ? 'border-red-400 bg-red-50 placeholder-red-300'
            : 'border-gray-300 bg-white',
    ].join(' ');
}

function formatJobState(state: FilingStatusResponse['state']): string {
    switch (state) {
        case 'waiting': return 'Queued';
        case 'active': return 'Processing';
        case 'completed': return 'Completed';
        case 'failed': return 'Failed';
        case 'delayed': return 'Delayed';
        default: return 'Unknown';
    }
}

function formatLogTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatLogProgress(log: FilingStepLog): string | null {
    return typeof log.progress === 'number' ? `${log.progress}%` : null;
}

function getPreviousMonthRange(referenceDate = new Date()): { periodFrom: string; periodTo: string } {
    const previousMonthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
    const previousMonthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0);

    return {
        periodFrom: previousMonthStart.toISOString().slice(0, 10),
        periodTo: previousMonthEnd.toISOString().slice(0, 10),
    };
}

function getDefaultFormValues(taxObligationType: TaxObligationType): FilingFormData {
    return {
        kraPin: '',
        kraPassword: '',
        periodFrom: '',
        periodTo: '',
        taxObligationType,
        ownsRentalProperty: false,
        rentalIncomeAmount: undefined,
        totYear: new Date().getFullYear(),
        totMonth: new Date().getMonth() === 0 ? 12 : new Date().getMonth(),
        totTurnover: undefined,
        otpCode: '',
    };
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * KraNilReturnForm
 *
 * Collects KRA iTax credentials and filing metadata, POSTs them to the
 * filing endpoint, and then tracks the queued worker execution.
 */
interface KraNilReturnFormProps {
    initialTaxObligationType?: TaxObligationType;
}

const KraNilReturnForm: React.FC<KraNilReturnFormProps> = ({
    initialTaxObligationType = 'income_tax_resident_individual',
}) => {
    const { toasts, addToast } = useToasts();
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<FilingStatusResponse | null>(null);

    const {
        register,
        handleSubmit,
        control,
        watch,
        reset,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FilingFormData>({
        defaultValues: getDefaultFormValues(initialTaxObligationType),
        mode: 'onBlur',
    });

    const selectedObligation = watch('taxObligationType');
    const selectedObligationOption = TAX_OBLIGATION_OPTIONS.find(
        (option) => option.value === selectedObligation
    );
    const isMriReturn = selectedObligation === 'monthly_rental_income';
    const isTotReturn = selectedObligation === 'turnover_tax';
    const isTransactionalReturn = selectedObligationOption?.filingMode === 'transactional';
    const selectedWorkflowTitle = isTransactionalReturn
        ? 'Return With Transactions'
        : 'Nil Filing';
    const workflowHint = isTotReturn
        ? 'Requires the Period Year, Month and Gross Turnover in order to calculate 1.5% tax.'
        : isMriReturn
            ? 'Requires the rental income amount and uses the previous month period when dates are not supplied.'
            : 'Requires the nil filing period and any nil-return-specific prompts such as the rental property toggle.';

    useEffect(() => {
        setValue('taxObligationType', initialTaxObligationType);
        setActiveJobId(null);
        setJobStatus(null);
    }, [initialTaxObligationType, setValue]);

    useEffect(() => {
        if (!activeJobId) {
            return;
        }

        let cancelled = false;
        let intervalId: number | undefined;

        const pollStatus = async () => {
            try {
                const status = await apiFetchJson<FilingStatusResponse>(`/tax/filing-status/${activeJobId}`);
                if (cancelled) {
                    return;
                }

                setJobStatus(status);

                if (status.state === 'failed') {
                    window.clearInterval(intervalId);
                    if (status.failedReason) {
                        addToast(status.failedReason, 'error');
                    }
                }

                if (status.state === 'completed') {
                    window.clearInterval(intervalId);
                    addToast('Filing completed successfully.', 'success');
                }
            } catch {
                // Ignore transient polling failures; the next interval will retry.
            }
        };

        void pollStatus();
        intervalId = window.setInterval(() => {
            void pollStatus();
        }, 2_000);

        return () => {
            cancelled = true;
            if (intervalId !== undefined) {
                window.clearInterval(intervalId);
            }
        };
    }, [activeJobId, addToast]);

    // ── Submission ─────────────────────────────────────────────────────────────

    const onSubmit = async (data: FilingFormData): Promise<void> => {
        try {
            const fallbackMriPeriod = getPreviousMonthRange();
            const result = await apiFetchJson<FilingResponse>('/tax/file-return', {
                method: 'POST',
                body: JSON.stringify({
                    ...data,
                    kraPin: data.kraPin.toUpperCase(),
                    periodFrom: isMriReturn
                        ? (data.periodFrom || fallbackMriPeriod.periodFrom)
                        : isTotReturn
                            ? undefined
                            : data.periodFrom,
                    periodTo: isMriReturn
                        ? (data.periodTo || fallbackMriPeriod.periodTo)
                        : isTotReturn
                            ? undefined
                            : data.periodTo,
                    ownsRentalProperty: (data.taxObligationType === 'income_tax_resident_individual' || data.taxObligationType === 'income_tax_non_resident_individual')
                        ? data.ownsRentalProperty
                        : false,
                    rentalIncomeAmount: isMriReturn ? 0 : undefined,
                    totYear: isTotReturn ? data.totYear : undefined,
                    totMonth: isTotReturn ? data.totMonth : undefined,
                    totTurnover: isTotReturn ? 0 : undefined,
                    otpCode: isTotReturn ? data.otpCode || undefined : undefined,
                    isNil: true,
                }),
            });

            if (result.success) {
                addToast(result.message, 'success');
                setActiveJobId(result.jobId ?? null);
                setJobStatus(result.jobId ? {
                    jobId: result.jobId,
                    state: 'waiting',
                    progress: 0,
                    attemptsMade: 0,
                    failedReason: null,
                    stepLogs: [],
                    lastStep: null,
                    credentialUpdate: null,
                    result: null,
                    processedOn: null,
                    finishedOn: null,
                } : null);
                reset(getDefaultFormValues(initialTaxObligationType));
            } else {
                addToast(
                    result.message ?? 'Filing failed. Please try again.',
                    'error'
                );
            }
        } catch (err) {
            const message = (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
                ? err.message
                : 'Network error. Please check your connection and try again.';
            addToast(message, 'error');
        }
    };

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center p-4">

            {/* ── Toast Notifications ─────────────────────────────────────────────── */}
            <div
                aria-live="polite"
                aria-atomic="false"
                className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full"
            >
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        role="alert"
                        className={[
                            'rounded-lg px-4 py-3 shadow-lg text-sm font-medium text-white',
                            'animate-in slide-in-from-right-4 fade-in duration-300',
                            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600',
                        ].join(' ')}
                    >
                        {toast.message}
                    </div>
                ))}
            </div>

            {/* ── Card ─────────────────────────────────────────────────────────────── */}
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl ring-1 ring-black/5 p-8">

                {/* Header */}
                <div className="mb-7 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 ring-1 ring-blue-100 rounded-2xl mb-4">
                        <DocumentIcon />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                        KRA Return Filing
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Choose a nil filing or a transaction-based return. The form adjusts the required prerequisites for the selected workflow.
                    </p>
                </div>

                {/* Form */}
                <form
                    onSubmit={handleSubmit(onSubmit)}
                    noValidate
                    aria-label="KRA Return Filing Form"
                    className="space-y-5"
                >
                    {/* ── KRA PIN ──────────────────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="kraPin"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            KRA PIN <span className="text-red-500" aria-hidden="true">*</span>
                        </label>
                        <input
                            id="kraPin"
                            type="text"
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            maxLength={11}
                            placeholder="A000000000Z"
                            aria-describedby={errors.kraPin ? 'kraPin-error' : undefined}
                            aria-invalid={!!errors.kraPin}
                            className={`${inputCls(!!errors.kraPin)} font-mono uppercase tracking-widest`}
                            {...register('kraPin', {
                                required: 'KRA PIN is required',
                                minLength: { value: 11, message: 'KRA PIN must be exactly 11 characters' },
                                maxLength: { value: 11, message: 'KRA PIN must be exactly 11 characters' },
                                pattern: {
                                    value: /^[A-Za-z0-9]{11}$/,
                                    message: 'KRA PIN must contain only letters and numbers',
                                },
                                setValueAs: (v: string) => v.toUpperCase().trim(),
                            })}
                        />
                        <FieldError message={errors.kraPin?.message} />
                    </div>

                    {/* ── Tax Obligation ────────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="taxObligationType"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            Filing Obligation <span className="text-red-500" aria-hidden="true">*</span>
                        </label>
                        <select
                            id="taxObligationType"
                            aria-invalid={!!errors.taxObligationType}
                            className={inputCls(!!errors.taxObligationType)}
                            {...register('taxObligationType', {
                                required: 'Select the return obligation to file',
                            })}
                        >
                            <optgroup label="Nil Filings">
                                {NIL_FILING_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Returns With Transactions">
                                {TRANSACTION_FILING_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </optgroup>
                        </select>
                        <FieldError message={errors.taxObligationType?.message} />
                        <p className="mt-1 text-xs text-gray-400">
                            Nil filings are separated from returns with transactions so the form can collect the correct prerequisites.
                        </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Selected Workflow
                                </p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">
                                    {selectedWorkflowTitle}
                                </p>
                                <p className="mt-1 text-sm text-slate-700 leading-relaxed">
                                    {selectedObligationOption?.description}
                                </p>
                            </div>
                            <span className={[
                                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
                                isTransactionalReturn
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-blue-100 text-blue-800',
                            ].join(' ')}>
                                {isTransactionalReturn ? 'Transactions' : 'Nil'}
                            </span>
                        </div>
                        <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                            {workflowHint}
                        </p>
                    </div>

                    {/* Removed rentalIncomeAmount form input completely, as this is the Nil Desk */}

                    {isTotReturn ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="totYear" className="block text-xs text-gray-500 mb-1">
                                        Filing Year <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="totYear"
                                        type="number"
                                        min="2000"
                                        placeholder="e.g. 2026"
                                        aria-invalid={!!errors.totYear}
                                        className={inputCls(!!errors.totYear)}
                                        {...register('totYear', {
                                            validate: (val) => !isTotReturn || (typeof val === 'number' && val > 2000) || 'Valid Year required',
                                            setValueAs: (v: string) => v === '' ? undefined : Number(v),
                                        })}
                                    />
                                    <FieldError message={errors.totYear?.message} />
                                </div>
                                <div>
                                    <label htmlFor="totMonth" className="block text-xs text-gray-500 mb-1">
                                        Filing Month (1-12) <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="totMonth"
                                        type="number"
                                        min="1"
                                        max="12"
                                        placeholder="e.g. 3"
                                        aria-invalid={!!errors.totMonth}
                                        className={inputCls(!!errors.totMonth)}
                                        {...register('totMonth', {
                                            validate: (val) => !isTotReturn || (typeof val === 'number' && val >= 1 && val <= 12) || 'Month must be 1-12',
                                            setValueAs: (v: string) => v === '' ? undefined : Number(v),
                                        })}
                                    />
                                    <FieldError message={errors.totMonth?.message} />
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* ── KRA Password ─────────────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="kraPassword"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            iTax Password <span className="text-red-500" aria-hidden="true">*</span>
                        </label>
                        <input
                            id="kraPassword"
                            type="password"
                            autoComplete="current-password"
                            placeholder="Enter your iTax password"
                            aria-describedby="password-hint"
                            aria-invalid={!!errors.kraPassword}
                            className={inputCls(!!errors.kraPassword)}
                            {...register('kraPassword', {
                                required: 'Password is required',
                            })}
                        />
                        <FieldError message={errors.kraPassword?.message} />
                        <p id="password-hint" className="mt-1 text-xs text-gray-400">
                            Submitted securely to the automation worker.
                        </p>
                    </div>

                    {isTotReturn ? (
                        <div>
                            <label
                                htmlFor="otpCode"
                                className="block text-sm font-medium text-gray-700 mb-1"
                            >
                                Mobile Verification Code <span className="text-gray-400">(optional)</span>
                            </label>
                            <input
                                id="otpCode"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="Enter OTP if you already have it"
                                aria-invalid={!!errors.otpCode}
                                className={inputCls(!!errors.otpCode)}
                                {...register('otpCode', {
                                    setValueAs: (value: string) => value.trim(),
                                })}
                            />
                            <FieldError message={errors.otpCode?.message} />
                            <p className="mt-1 text-xs text-gray-400">
                                Only used for ToT mobile verification. Leave it blank if the worker will source the OTP from your SMS integration.
                            </p>
                        </div>
                    ) : null}

                    {/* ── Date Range ───────────────────────────────────────────────────── */}
                    {!isTotReturn ? (
                        <fieldset>
                            <legend className="text-sm font-medium text-gray-700 mb-2">
                                Nil Filing Period <span className="text-red-500" aria-hidden="true">*</span>
                            </legend>
                            <div className="grid grid-cols-2 gap-3">
                                {/* Period From */}
                                <div>
                                    <label htmlFor="periodFrom" className="block text-xs text-gray-500 mb-1">
                                        From
                                    </label>
                                    <input
                                        id="periodFrom"
                                        type="date"
                                        aria-invalid={!!errors.periodFrom}
                                        className={inputCls(!!errors.periodFrom)}
                                        {...register('periodFrom', {
                                            required: isMriReturn ? false : 'Start date is required',
                                        })}
                                    />
                                    <FieldError message={errors.periodFrom?.message} />
                                </div>

                                {/* Period To */}
                                <div>
                                    <label htmlFor="periodTo" className="block text-xs text-gray-500 mb-1">
                                        To
                                    </label>
                                    <input
                                        id="periodTo"
                                        type="date"
                                        aria-invalid={!!errors.periodTo}
                                        className={inputCls(!!errors.periodTo)}
                                        {...register('periodTo', {
                                            required: isMriReturn ? false : 'End date is required',
                                            validate: (value, formValues) =>
                                                !formValues.periodFrom ||
                                                new Date(value) >= new Date(formValues.periodFrom) ||
                                                'End date must be on or after start date',
                                        })}
                                    />
                                    <FieldError message={errors.periodTo?.message} />
                                </div>
                            </div>
                        </fieldset>
                    ) : null}

                    {/* ── Rental Property Toggle ───────────────────────────────────────── */}
                    {selectedObligation === 'income_tax_resident_individual' || selectedObligation === 'income_tax_non_resident_individual' ? (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-800">
                                        Owns Rental Property?
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                                        Nil filing prerequisite only. This is used only when the selected KRA nil return asks about rental property for the filing period.
                                    </p>
                                </div>
                                <Controller
                                    name="ownsRentalProperty"
                                    control={control}
                                    render={({ field }) => (
                                        <ToggleSwitch
                                            checked={field.value}
                                            onChange={field.onChange}
                                            disabled={isSubmitting}
                                        />
                                    )}
                                />
                            </div>
                        </div>
                    ) : null}

                    {/* ── Submit ───────────────────────────────────────────────────────── */}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className={[
                            'w-full py-3 px-4 rounded-xl font-semibold text-sm',
                            'transition-all duration-200',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                            isSubmitting
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white shadow-sm hover:shadow-md',
                        ].join(' ')}
                    >
                        {isSubmitting ? (
                            <span className="inline-flex items-center justify-center gap-2">
                                <SpinnerIcon />
                                Queuing return…
                            </span>
                        ) : (
                            isTotReturn
                                ? 'Queue ToT Filing'
                                : isMriReturn
                                    ? 'Queue MRI Filing'
                                    : 'Queue Nil Filing'
                        )}
                    </button>
                </form>

                {(activeJobId || jobStatus) ? (
                    <div className="mt-5 rounded-xl border border-gray-200 bg-slate-50 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium text-gray-800">Latest Filing Job</p>
                                <p className="text-xs text-gray-500 font-mono break-all">
                                    {jobStatus?.jobId ?? activeJobId}
                                </p>
                            </div>
                            <span className={[
                                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
                                jobStatus?.state === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : jobStatus?.state === 'failed'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-blue-100 text-blue-700',
                            ].join(' ')}>
                                {formatJobState(jobStatus?.state ?? 'waiting')}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
                            <div>
                                <p className="text-gray-400">Progress</p>
                                <p className="mt-1 font-medium text-gray-800">
                                    {typeof jobStatus?.progress === 'number' ? `${jobStatus.progress}%` : 'Pending'}
                                </p>
                            </div>
                            <div>
                                <p className="text-gray-400">Attempts</p>
                                <p className="mt-1 font-medium text-gray-800">
                                    {jobStatus?.attemptsMade ?? 0}
                                </p>
                            </div>
                        </div>

                        {jobStatus?.lastStep ? (
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Last Recorded Step
                                        </p>
                                        <p className="mt-1 text-sm font-medium text-slate-900 leading-relaxed">
                                            {jobStatus.lastStep.message}
                                        </p>
                                    </div>
                                    <div className="text-right text-xs text-slate-500 whitespace-nowrap">
                                        <p>{formatLogTimestamp(jobStatus.lastStep.timestamp)}</p>
                                        {formatLogProgress(jobStatus.lastStep) ? (
                                            <p className="mt-1 font-medium text-slate-700">
                                                {formatLogProgress(jobStatus.lastStep)}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {jobStatus?.state === 'completed' && (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-emerald-800">
                                            Filing completed successfully
                                        </p>
                                        {jobStatus.result?.receiptNumber ? (
                                            <p className="mt-1 text-xs text-emerald-700">
                                                Receipt Number: <span className="font-mono font-semibold">{jobStatus.result.receiptNumber}</span>
                                            </p>
                                        ) : null}
                                        {jobStatus.result?.receiptPath ? (
                                            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700">
                                                <Receipt className="h-3.5 w-3.5" />
                                                <span className="break-all">{jobStatus.result.receiptPath}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        )}

                        {jobStatus?.failedReason ? (
                            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
                                        <AlertCircle className="h-5 w-5 text-red-600" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-red-800">
                                            Filing failed
                                        </p>
                                        <p className="mt-1 text-sm text-red-700 leading-relaxed">
                                            {jobStatus.failedReason}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {jobStatus?.credentialUpdate ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                                    Password Updated
                                </p>
                                <p className="mt-1 text-sm text-amber-900 leading-relaxed">
                                    KRA required a password change during login. The bot generated a new password and continued filing with that credential.
                                </p>
                                <p className="mt-2 text-xs text-amber-700">New iTax password</p>
                                <p className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 break-all">
                                    {jobStatus.credentialUpdate.newPassword}
                                </p>
                            </div>
                        ) : null}

                        {jobStatus?.stepLogs.length ? (
                            <FilingStepTimeline
                                logs={jobStatus.stepLogs}
                                isActive={jobStatus.state === 'active' || jobStatus.state === 'waiting'}
                            />
                        ) : null}
                    </div>
                ) : null}

                {/* Security footnote */}
                <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                    <LockIcon />
                    <span>Processed securely in background</span>
                </div>
            </div>
        </div>
    );
};

export default KraNilReturnForm;
