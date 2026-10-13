import type { LocalModelStatus } from '@shared/types'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useEvent } from './useEvent'

/** The local speech-to-text model and its download, kept current by main's `localModel:status` events. */
export function useLocalModel(): [LocalModelStatus | null, (s: LocalModelStatus) => void] {
  const [status, setStatus] = useState<LocalModelStatus | null>(null)
  useEffect(() => {
    let live = true
    api
      .getLocalModelStatus()
      .then((s) => live && setStatus((cur) => cur ?? s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  useEvent('localModel:status', setStatus)
  return [status, setStatus]
}
