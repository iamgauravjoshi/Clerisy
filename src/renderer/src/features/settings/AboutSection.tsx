import { type AppInfo, REPO_URL } from '@shared/types'
import { Bug, ExternalLink, FolderOpen } from 'lucide-react'
import { api } from '../../api'
import { BrandMark } from '../../components/layout'
import { Badge, Banner, Button, buttonVariants, Icon } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { SettingsSection } from './SettingsSection'

const LINKS = [
  { href: REPO_URL, label: 'Source code on GitHub', icon: ExternalLink },
  { href: `${REPO_URL}/issues/new`, label: 'Report a problem', icon: Bug }
]

/** The version, where the data lives, and where to get help. */
export function AboutSection({ info }: { info: AppInfo }) {
  const open = useAction()
  return (
    <SettingsSection id="settings-about" title="About">
      <div className="flex items-center gap-3">
        <BrandMark size="lg" />
        <div className="flex flex-col">
          <span className="text-body-strong">MeetingBuddy</span>
          <span className="flex items-center gap-2 text-fg-secondary text-small">
            Version {info.version}
            {!info.packaged && <Badge>Running from source</Badge>}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-body-strong">Data folder</span>
        <p className="text-fg-secondary text-small">Where your projects, meetings, settings and recordings are stored on this computer.</p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="min-w-0 break-all rounded-md bg-inset px-2 py-1 font-mono text-fg-secondary text-mono">{info.dataDir}</code>
          <Button size="sm" icon={FolderOpen} loading={open.busy} onClick={() => void open.run(() => api.openDataFolder())}>
            Open folder
          </Button>
        </div>
        {open.error && <Banner tone="danger">{open.error}</Banner>}
      </div>

      <div className="flex flex-wrap gap-2">
        {LINKS.map((l) => (
          // links open in the browser (the window's open handler only lets http(s) through)
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <Icon icon={l.icon} />
            {l.label}
          </a>
        ))}
      </div>
    </SettingsSection>
  )
}
