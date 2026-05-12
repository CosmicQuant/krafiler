import React from 'react';

interface ToggleSwitchProps {
    /** Current on/off state. */
    checked: boolean;
    /** Called when the user clicks the toggle. */
    onChange: (value: boolean) => void;
    /** Accessible label surfaced to screen readers via aria-labelledby. */
    label?: string;
    disabled?: boolean;
}

/**
 * Accessible Yes/No toggle switch built with a `<button role="switch">`.
 * Styled with Tailwind — no third-party toggle library needed.
 */
const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
    checked,
    onChange,
    label,
    disabled = false,
}) => {
    const id = React.useId();

    return (
        <div className="flex items-center gap-3">
            {label && (
                <span id={id} className="text-sm font-medium text-gray-700 select-none">
                    {label}
                </span>
            )}

            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-labelledby={label ? id : undefined}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={[
                    'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full',
                    'transition-colors duration-200 ease-in-out',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                    checked ? 'bg-blue-600' : 'bg-gray-300',
                    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                ].join(' ')}
            >
                <span
                    aria-hidden="true"
                    className={[
                        'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm',
                        'transition-transform duration-200 ease-in-out',
                        checked ? 'translate-x-6' : 'translate-x-1',
                    ].join(' ')}
                />
            </button>

            <span className="text-sm text-gray-500 select-none">
                {checked ? 'Yes' : 'No'}
            </span>
        </div>
    );
};

export default ToggleSwitch;
