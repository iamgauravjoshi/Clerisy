import type { UpdateStatus } from '@shared/types'
import { RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { Banner, Button, ProgressBar, Spinner, Switch } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { useUpdateStatus } from '../../hooks/useUpdateStatus'
import { fmtRelative } from '../../lib/format'

function describe(s: UpdateStatus): string {
  switch (s.state) {
    case 'unsupported':
      return 'Running from source: updates come from pulling the code, not from GitHub releases.'
    case 'idle':
      return s.checkedAt ? `MeetingBuddy is up to date. Checked ${fmtRelative(s.checkedAt)}.` : 'Not checked for updates yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading MeetingBuddy ${s.version}… ${s.percent}%`
    case 'downloaded':
      return `MeetingBuddy ${s.version} is ready. Restart to update now, or it installs the next time you quit.`
    case 'error':
      return `Last check ${fmtRelative(s.checkedAt)}.`
  }
}

/** Updates from GitHub Releases: the current status, a manual check, the restart, and the automatic-check setting. */
export function UpdatesPanel({ autoUpdate, onAutoUpdate }: { autoUpdate: boolean; onAutoUpdate: (on: boolean) => void }) {
  const [status, setStatus] = useUpdateStatus()
  const check = useAction()
  const install = useAction()
  if (!status) return null
  const supported = status.state !== 'unsupported'

  return (
    <div className="flex flex-col gap-3">
      <span className="text-body-strong">Updates</span>
      <p role="status" className="flex items-center gap-2 text-fg-secondary text-small">
        {status.state === 'checking' && <Spinner />}
        {describe(status)}
      </p>
      {status.state === 'downloading' && <ProgressBar label="Downloading update" value={status.percent} max={100} />}
      {status.state === 'error' && <Banner tone="warning">{status.message}</Banner>}
      {(check.error || install.error) && <Banner tone="danger">{check.error ?? install.error}</Banner>}
      {supported && (
        <div className="flex flex-wrap gap-2">
          {status.state === 'downloaded' ? (
            <Button
              variant="primary"
              size="sm"
              icon={RefreshCw}
              loading={install.busy}
              onClick={() => void install.run(() => api.installUpdate())}
            >
              Restart to update
            </Button>
          ) : (
            <Button
              size="sm"
              icon={RefreshCw}
              loading={check.busy || status.state === 'checking'}
              disabled={status.state === 'downloading'}
              onClick={() => void check.run(async () => setStatus(await api.checkForUpdates()))}
            >
              {status.state === 'error' ? 'Try again' : 'Check for updates'}
            </Button>
          )}
        </div>
      )}
      <Switch
        checked={autoUpdate}
        onChange={onAutoUpdate}
        disabled={!supported}
        label="Check for updates automatically"
        hint="Checks GitHub a little after MeetingBuddy starts and every few hours, never while recording, and downloads new versions in the background."
      />
    </div>
  )
}
