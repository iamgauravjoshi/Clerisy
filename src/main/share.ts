import { BrowserWindow, clipboard, dialog, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { renderShare, renderShareHtml, type ShareFormat, type ShareInput, type ShareOptions, shareFileName } from '@shared/reportExport'
import * as db from './db'

// Sharing a meeting's Impact Report: copy it for Slack/WhatsApp/Markdown, or save it as a Markdown or PDF file.
// The text is always built here from the database, never taken from the renderer.

/** Everything a share needs, read fresh from the database. */
export function shareInput(meetingId: string): ShareInput {
  const meeting = db.getMeeting(meetingId)
  const rep = db.getReport(meetingId)
  if (!meeting || !rep) throw new Error('This meeting has no Impact Report to share yet.')
  const project = db.getProject(meeting.projectId)
  const targetTitles = Object.fromEntries(db.listItems(meeting.projectId).map((i) => [i.id, i.title]))
  return {
    projectName: project?.name ?? '',
    meeting,
    report: rep.report,
    proposals: rep.proposals,
    targetTitles,
    segments: db.listSegments(meetingId)
  }
}

export function previewShare(meetingId: string, format: ShareFormat, options: ShareOptions): string {
  return renderShare(shareInput(meetingId), format, options)
}

/** Copies with Electron's clipboard: the sandboxed page has no clipboard permission. */
export function copyShare(meetingId: string, format: ShareFormat, options: ShareOptions): void {
  clipboard.writeText(previewShare(meetingId, format, options))
}

// the last file saved, so "Show in folder" never takes a path from the renderer
let lastSaved: string | null = null

/** Renders the page in a hidden window with JavaScript off and nothing loaded from outside, then prints it to PDF. */
async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
  } finally {
    win.destroy()
  }
}

/** Asks where to save, then writes Markdown or a PDF. Resolves with the file's name, or null if cancelled. */
export async function exportShare(meetingId: string, kind: 'markdown' | 'pdf', options: ShareOptions): Promise<string | null> {
  const input = shareInput(meetingId)
  const ext = kind === 'pdf' ? 'pdf' : 'md'
  const parent = BrowserWindow.getFocusedWindow()
  const opts: Electron.SaveDialogOptions = {
    title: kind === 'pdf' ? 'Save report as PDF' : 'Save report as Markdown',
    defaultPath: shareFileName(input, ext),
    filters: [kind === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Markdown', extensions: ['md'] }]
  }
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return null
  if (kind === 'pdf') writeFileSync(r.filePath, await htmlToPdf(renderShareHtml(input, options)))
  else writeFileSync(r.filePath, renderShare(input, 'markdown', options), 'utf8')
  lastSaved = r.filePath
  return r.filePath.split(/[\\/]/).pop() ?? r.filePath
}

/** Shows the last saved report in Explorer. */
export function revealLastExport(): void {
  if (!lastSaved) throw new Error('Nothing has been saved yet.')
  shell.showItemInFolder(lastSaved)
}
