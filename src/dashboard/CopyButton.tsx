import { useState } from 'react';

/** Small "Copy" button that writes `text` to the clipboard and briefly
 *  confirms. Used for copyable REST request snippets across tabs. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard unavailable; user can still select the text */ });
  };
  return (
    <button className="copy-btn" onClick={copy} title="Copy to clipboard">
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}
