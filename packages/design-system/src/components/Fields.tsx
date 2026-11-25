import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

interface FieldChromeProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  hintId: string;
  errorId: string;
}

function FieldChrome({ id, label, hint, error, required, hintId, errorId }: FieldChromeProps) {
  if (!label && !hint && !error) return null;
  return (
    <>
      {label && (
        <label className="rh-label" htmlFor={id}>
          {label}
          {required && (
            <span className="rh-label__required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {error ? (
        <span className="rh-error-text" id={errorId} role="alert">
          <Icon name="alert" size="sm" /> {error}
        </span>
      ) : (
        hint && (
          <span className="rh-hint" id={hintId}>
            {hint}
          </span>
        )
      )}
    </>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  leadingIcon?: IconName;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, suffix, className, id, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="rh-field">
      <FieldChrome
        id={inputId}
        label={label}
        hint={hint}
        error={error}
        required={required}
        hintId={hintId}
        errorId={errorId}
      />
      <div className={cx('rh-input-group', leadingIcon && 'rh-input-group--icon')}>
        {leadingIcon && (
          <span className="rh-input-group__icon">
            <Icon name={leadingIcon} size="sm" />
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cx('rh-input', className)}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {suffix && <span className="rh-input-group__suffix">{suffix}</span>}
      </div>
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const hintId = `${areaId}-hint`;
  const errorId = `${areaId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="rh-field">
      <FieldChrome
        id={areaId}
        label={label}
        hint={hint}
        error={error}
        required={required}
        hintId={hintId}
        errorId={errorId}
      />
      <textarea
        ref={ref}
        id={areaId}
        className={cx('rh-textarea', className)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, className, id, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="rh-field">
      <FieldChrome
        id={selectId}
        label={label}
        hint={hint}
        error={error}
        required={required}
        hintId={hintId}
        errorId={errorId}
      />
      <select
        ref={ref}
        id={selectId}
        className={cx('rh-select', className)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
});

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('rh-checkbox', className)}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

export function Switch({ label, className, ...rest }: SwitchProps) {
  return (
    <label className={cx('rh-switch', className)}>
      <input type="checkbox" role="switch" {...rest} />
      {label && <span>{label}</span>}
    </label>
  );
}
