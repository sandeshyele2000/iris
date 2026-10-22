const keyLabels: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Super: '⌘',
  Meta: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Backspace: '⌫',
  Delete: '⌦',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '−',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};
export function ShortcutKeys({ value }: { value: string }) {
  return value ? (
    value
      .split('+')
      .map((key, index) => (
        <kbd key={index}>{keyLabels[key] ?? key.replace(/^(Key|Digit)/, '')}</kbd>
      ))
  ) : (
    <span className="muted">Set shortcut</span>
  );
}
