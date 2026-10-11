// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAction } from '../../src/renderer/src/hooks/useAction'

function Saver({ action, twice = false }: { action: () => Promise<unknown>; twice?: boolean }) {
  const { run, busy, error } = useAction()
  return (
    <>
      <button
        onClick={() => {
          void run(action)
          if (twice) void run(action) // a second trigger before React re-renders, e.g. Enter key plus click
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}

afterEach(cleanup)

describe('useAction', () => {
  it('shows the error of a failed action instead of losing it', async () => {
    render(<Saver action={async () => Promise.reject(new Error('Disk full'))} />)
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText('Disk full')).toBeTruthy()
    expect(screen.getByText('Save')).toBeTruthy()
  })

  it('reports that it is busy while the action runs', async () => {
    let finish!: () => void
    render(<Saver action={() => new Promise<void>((r) => (finish = r))} />)
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Saving…')).toBeTruthy()
    await act(async () => finish())
    expect(screen.getByText('Save')).toBeTruthy()
  })

  it('ignores a second action while one is running', async () => {
    const action = vi.fn(async () => {})
    render(<Saver action={action} twice />)
    await act(async () => fireEvent.click(screen.getByText('Save')))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('clears the previous error when an action is run again', async () => {
    let fail = true
    render(<Saver action={async () => (fail ? Promise.reject(new Error('Offline')) : undefined)} />)
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Offline')
    fail = false
    await act(async () => fireEvent.click(screen.getByText('Save')))
    expect(screen.queryByText('Offline')).toBeNull()
  })
})
