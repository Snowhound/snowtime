// TextFieldInput's look on a plain input, since DatePicker and TimeInput keep their own text
// apart from their value and so don't use Kobalte's TextField. aria-invalid marks errors.
export const FIELD_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-error-foreground aria-[invalid=true]:text-error-foreground'
