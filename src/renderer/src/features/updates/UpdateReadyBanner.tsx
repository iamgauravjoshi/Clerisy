import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Banner, Button } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { useUpdateStatus } from '../../hooks/useUpdateStatus'

/**
 * "MeetingBuddy 0.2.0 is ready": offers the restart once an update has downloaded. Hidden while recording (restarting
 * would cut the recording off) and after Later, until the next version. Quitting installs it too.
 */
export function UpdateReadyBanner({ recording }: { recording: boolean }) {
  const [status] = useUpdateStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const install = useAction()
  if (status?.state !== 'downloaded' || recording || dismissed === status.version) return null
  return (
    <Banner
      tone="success"
      title={`MeetingBuddy ${status.version} is ready`}
      className="rounded-none border-x-0 border-t-0 px-6"
      actions={
        <>
          <Button
            size="sm"
            variant="primary"
            icon={RefreshCw}
            loading={install.busy}
            onClick={() => void install.run(() => api.installUpdate())}
          >
            Restart to update
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(status.version)}>
            Later
          </Button>
        </>
      }
    >
      Restart now, or it installs the next time you quit MeetingBuddy.
      {install.error && <span className="block text-danger-fg">{install.error}</span>}
    </Banner>
  )
}
