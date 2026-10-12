import type { UpdateStatus } from '@shared/types'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useEvent } from './useEvent'

/** The updater's status, kept current by main's `update:status` events. Null until it has loaded. */
export function useUpdateStatus(): [UpdateStatus | null, (s: UpdateStatus) => void] {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let live = true
    // without a status there's simply no update UI; nothing to report
    api
      .getUpdateStatus()
      .then((s) => live && setStatus((cur) => cur ?? s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  useEvent('update:status', setStatus)
  return [status, setStatus]
}
