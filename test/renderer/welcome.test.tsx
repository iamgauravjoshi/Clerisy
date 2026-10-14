// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WelcomePage } from '../../src/renderer/src/pages/WelcomePage'
import { SETTINGS } from './fakeMb'

// The first screen (DESIGN.md §6.1): what Clerisy does, how to start, and what's left to set up.

afterEach(cleanup)

describe('welcome page', () => {
  it('explains the three steps and starts a project', () => {
    const onCreateProject = vi.fn()
    render(<WelcomePage settings={SETTINGS} onCreateProject={onCreateProject} onOpenSettings={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/what changed in your project/)
    expect(within(screen.getByRole('list', { name: 'How it works' })).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }))
    expect(onCreateProject).toHaveBeenCalled()
  })

  it('lists what is left to set up, each linking to Settings', () => {
    const onOpenSettings = vi.fn()
    render(<WelcomePage settings={{ ...SETTINGS, selfName: 'Gaurav' }} onCreateProject={() => {}} onOpenSettings={onOpenSettings} />)
    expect(screen.getByRole('heading', { name: 'Finish setting up' })).toBeTruthy()
    expect(screen.getByText('1 of 3 done')).toBeTruthy()
    expect(screen.getByText(/Set your name/).textContent).toContain('(done)')
    expect(screen.queryByRole('button', { name: 'Set your name in Settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add an AI model key in Settings' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('says so when setup is complete', () => {
    render(
      <WelcomePage
        settings={{ ...SETTINGS, selfName: 'Gaurav', sttProvider: 'deepgram', hasKey: { anthropic: true, deepgram: true } }}
        onCreateProject={() => {}}
        onOpenSettings={() => {}}
      />
    )
    expect(screen.getByRole('heading', { name: 'Setup is complete' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /in Settings$/ })).toBeNull()
  })
})
