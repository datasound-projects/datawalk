/** Text input that commits on blur or Enter, so that each edit is one undo step. */
export function Text({
  label,
  value,
  onCommit,
  placeholder,
  multiline,
  required,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  multiline?: boolean
  required?: boolean
}) {
  const commit = (v: string) => {
    if (v === value || (required && !v.trim())) return
    onCommit(v)
  }
  // key={value}: a new value from undo or redo resets the uncontrolled field.
  const common = {
    defaultValue: value,
    placeholder,
    'aria-label': label,
    onBlur: (e: { target: { value: string } }) => commit(e.target.value),
  }
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea key={value} rows={3} {...common} />
      ) : (
        <input key={value} {...common} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
    </label>
  )
}
