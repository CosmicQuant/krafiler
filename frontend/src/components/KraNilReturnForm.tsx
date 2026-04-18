import React, { useState, useCallback, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import ToggleSwitch from './ToggleSwitch';
import {
    NilReturnFormData,
    FilingResponse,
    FilingStatusResponse,
    TAX_OBLIGATION_OPTIONS,
} from '../types';

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

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * KraNilReturnForm
 *
 * Collects KRA iTax credentials and filing metadata, POSTs them to the
 * /api/tax/file-nil-return endpoint, and immediately shows a success toast
 * without blocking on the background automation run.
 */
const KraNilReturnForm: React.FC = () => {
    const { toasts, addToast } = useToasts();
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<FilingStatusResponse | null>(null);

    const {
        register,
        handleSubmit,
        control,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<NilReturnFormData>({
        defaultValues: {
            kraPin: '',
            kraPassword: '',
            periodFrom: '',
            periodTo: '',
            taxObligationType: 'income_tax_resident_individual',
            ownsRentalProperty: false,
        },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!activeJobId) {
            return;
        }

        let cancelled = false;
        let intervalId: number | undefined;

        const pollStatus = async () => {
            try {
                const response = await fetch(`/api/tax/filing-status/${activeJobId}`);
                if (!response.ok) {
                    return;
                }

                const status: FilingStatusResponse = await response.json();
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
        }, 4_000);

        return () => {
            cancelled = true;
            if (intervalId !== undefined) {
                window.clearInterval(intervalId);
            }
        };
    }, [activeJobId, addToast]);

    // ── Submission ─────────────────────────────────────────────────────────────

    const onSubmit = async (data: NilReturnFormData): Promise<void> => {
        try {
            const response = await fetch('/api/tax/file-nil-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // kraPin is uppercased by the form; backend validates too
                body: JSON.stringify({
                    ...data,
                    kraPin: data.kraPin.toUpperCase(),
                }),
            });

            const result: FilingResponse = await response.json();

            if (response.ok && result.success) {
                addToast(result.message, 'success');
                setActiveJobId(result.jobId ?? null);
                setJobStatus(result.jobId ? {
                    jobId: result.jobId,
                    state: 'waiting',
                    progress: 0,
                    attemptsMade: 0,
                    failedReason: null,
                    processedOn: null,
                    finishedOn: null,
                } : null);
                reset();
            } else {
                addToast(
                    result.message ?? 'Filing failed. Please try again.',
                    'error'
                );
            }
        } catch {
            addToast(
                'Network error. Please check your connection and try again.',
                'error'
            );
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
                        KRA Nil Return Filing
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Queue a KRA nil return and track any blocking portal warnings
                    </p>
                </div>

                {/* Form */}
                <form
                    onSubmit={handleSubmit(onSubmit)}
                    noValidate
                    aria-label="KRA Nil Return Form"
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
                            Nil Return Obligation <span className="text-red-500" aria-hidden="true">*</span>
                        </label>
                        <select
                            id="taxObligationType"
                            aria-invalid={!!errors.taxObligationType}
                            className={inputCls(!!errors.taxObligationType)}
                            {...register('taxObligationType', {
                                required: 'Select the nil return obligation to file',
                            })}
                        >
                            {TAX_OBLIGATION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <FieldError message={errors.taxObligationType?.message} />
                        <p className="mt-1 text-xs text-gray-400">
                            Choose the tax obligation you want the worker to select in KRA.
                        </p>
                    </div>

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
                            Encrypted with AES-256-GCM before leaving your browser.
                        </p>
                    </div>

                    {/* ── Date Range ───────────────────────────────────────────────────── */}
                    <fieldset>
                        <legend className="text-sm font-medium text-gray-700 mb-2">
                            Filing Period <span className="text-red-500" aria-hidden="true">*</span>
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
                                        required: 'Start date is required',
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
                                        required: 'End date is required',
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

                    {/* ── Rental Property Toggle ───────────────────────────────────────── */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800">
                                    Owns Rental Property?
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                                    Used only if the selected KRA form asks about rental property
                                    for the filing period.
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
                            'File Nil Return'
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

                        {jobStatus?.failedReason ? (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                                    KRA Warning
                                </p>
                                <p className="mt-1 text-sm text-red-800 leading-relaxed">
                                    {jobStatus.failedReason}
                                </p>
                            </div>
                        ) : null}

                        {jobStatus?.state !== 'failed' ? (
                            <p className="text-xs text-gray-500 leading-relaxed">
                                If KRA blocks the filing with a warning dialog, the exact portal message will appear here.
                            </p>
                        ) : null}
                    </div>
                ) : null}

                {/* Security footnote */}
                <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                    <LockIcon />
                    <span>AES-256-GCM encrypted · Processed securely in background</span>
                </div>
            </div>
        </div>
    );
};

export default KraNilReturnForm;
