import type { DetectedMeeting } from '@shared/types'
import { Mic } from 'lucide-react'
import { Banner, Button } from '../../components/ui'

/** "Zoom is using your microphone": offers to record a meeting the detector noticed. */
export function DetectedMeetingBanner({
  meeting,
  onRecord,
  onIgnore
}: {
  meeting: DetectedMeeting
  onRecord: () => void
  onIgnore: () => void
}) {
  return (
    <Banner
      tone="info"
      title="Meeting detected"
      className="rounded-none border-x-0 border-t-0 px-6"
      actions={
        <>
          <Button size="sm" variant="primary" icon={Mic} onClick={onRecord}>
            Record
          </Button>
          <Button size="sm" variant="ghost" onClick={onIgnore}>
            Ignore
          </Button>
        </>
      }
    >
      {meeting.app} is using your microphone. Record this meeting?
    </Banner>
  )
}
