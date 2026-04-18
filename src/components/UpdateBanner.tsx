import { useEffect, useState } from 'react';

interface PendingUpdate {
  version: string;
  detectedAt: string;
  previousVersion: string;
}

export function UpdateBanner({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    chrome.storage.local.get('pendingUpdate').then((result) => {
      if (result.pendingUpdate) setPending(result.pendingUpdate as PendingUpdate);
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes.pendingUpdate) {
        setPending((changes.pendingUpdate.newValue as PendingUpdate | undefined) ?? null);
        setDismissed(false);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  if (!pending || dismissed) return null;

  const handleReload = () => {
    chrome.runtime.reload();
  };

  return (
    <div className={`update-banner ${compact ? 'compact' : ''}`}>
      <div className="update-banner-content">
        <span className="update-banner-icon">\u2728</span>
        <div className="update-banner-text">
          <strong>New version available</strong>
          {!compact && (
            <span className="update-banner-sub">
              v{pending.previousVersion} &rarr; v{pending.version}. Your clusters and settings will be preserved.
            </span>
          )}
        </div>
      </div>
      <div className="update-banner-actions">
        <button className="btn btn-update-reload" onClick={handleReload} title="Reload the extension to apply the new version">
          Reload {compact ? '' : 'now'}
        </button>
        <button className="btn-update-dismiss" onClick={() => setDismissed(true)} title="Dismiss">
          &times;
        </button>
      </div>
    </div>
  );
}
