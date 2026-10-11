// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/App'
import { fakeMb, PROJECT, PROJECT_PAGE, SETTINGS } from './fakeMb'

const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } })
}
const modal = (): HTMLElement => screen.getByRole('dialog')
const fail = (message: string) => async () => Promise.reject(new Error(message))

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('creating a project', () => {
  const app = (createProject: (...a: any[]) => unknown) => {
    const projects: (typeof PROJECT)[] = []
    const invoke = fakeMb({
      listProjects: () => projects,
      getSettings: () => SETTINGS,
      createProject: async (...args: unknown[]) => {
        const p = await createProject(...args)
        projects.push(p as typeof PROJECT)
        return p
      },
      ...PROJECT_PAGE
    })
    render(<App />)
    return invoke
  }

  it('creates one project even when Create is clicked twice', async () => {
    let finish!: (p: typeof PROJECT) => void
    const invoke = app(() => new Promise((r) => (finish = r)))
    fireEvent.click(await screen.findByText('Create your first project'))
    type(within(modal()).getAllByRole('textbox')[0], 'Phoenix')
    const create = within(modal()).getByText('Create')
    fireEvent.click(create)
    fireEvent.click(create)
    await act(async () => finish(PROJECT))
    expect(invoke.mock.calls.filter(([name]) => name === 'createProject')).toHaveLength(1)
  })

  it('shows why creating failed and keeps the dialog open', async () => {
    app(fail('Database is locked'))
    fireEvent.click(await screen.findByText('Create your first project'))
    type(within(modal()).getAllByRole('textbox')[0], 'Phoenix')
    fireEvent.click(within(modal()).getByText('Create'))
    expect(await within(modal()).findByText('Database is locked')).toBeTruthy()
  })
})
