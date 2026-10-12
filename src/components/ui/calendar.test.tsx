import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { de } from 'react-day-picker/locale'

import { Calendar } from '@/components/ui/calendar'

// WCAG 2.5.3 (Label in Name): each day button's name contains the number it shows, as a word.
// The browser tier's axe run checks the rendered stories; these pin the name itself, including
// the translated-locale case no story renders.
const JULY_2026 = new Date(2026, 6, 1)
const dayButtons = () => screen.getAllByRole('button').filter((button) => /^\d+$/.test(button.textContent ?? ''))
const dayButton = (shown: string) => dayButtons().find((button) => button.textContent === shown)

describe('Calendar: day button names contain the shown day (SC 2.5.3)', () => {
  it('leads with the shown number when the English label writes it as an ordinal', () => {
    render(<Calendar mode="single" month={JULY_2026} showOutsideDays={false} />)

    expect(dayButton('26')).toHaveAccessibleName('26, Sunday, July 26th, 2026')
  })

  it('keeps the today and selected parts of the label', () => {
    const july26 = new Date(2026, 6, 26)
    render(<Calendar mode="single" month={JULY_2026} today={july26} selected={july26} showOutsideDays={false} />)

    expect(dayButton('26')).toHaveAccessibleName('26, Today, Sunday, July 26th, 2026, selected')
  })

  it('leaves a translated label that already contains the number as it is', () => {
    render(<Calendar mode="single" locale={de} month={JULY_2026} showOutsideDays={false} />)

    expect(dayButton('26')).toHaveAccessibleName('Sonntag, 26. Juli 2026')
  })

  it('names every day of an English month this way', () => {
    render(<Calendar mode="single" month={JULY_2026} showOutsideDays={false} />)

    const days = dayButtons()
    expect(days).toHaveLength(31) // positive control: the check below examined the whole month
    for (const button of days) expect(button.getAttribute('aria-label')).toMatch(new RegExp(`^${button.textContent}, `))
  })
})
