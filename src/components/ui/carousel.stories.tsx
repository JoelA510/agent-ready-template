import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from './carousel'
import { Card, CardContent } from './card'

const meta = {
  title: 'Components/Carousel',
  component: Carousel,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A slide carousel built on `embla-carousel-react`, composed the shadcn way: `Carousel` owns the embla instance and shares it through context, while `CarouselContent`, `CarouselItem`, `CarouselPrevious`, and `CarouselNext` read from that context — arrow keys scroll when the region is focused, and the prev/next buttons disable at the ends. This is the one component in the library aimed at the company\'s public marketing site rather than the internal dashboard: rotating customer testimonials, product highlights, or award callouts on a landing page. Avoid it for anything the user needs to compare or act on at once (projects, invoices, search results) — hiding data behind a swipe hurts more than it helps; use a list, table, or grid there instead.',
      },
    },
  },
} satisfies Meta<typeof Carousel>

export default meta
type Story = StoryObj<typeof meta>

const testimonials = [
  {
    quote:
      'Acme untangled a reporting workflow that had stalled our team for months. They felt like an extension of our own team, not just a vendor.',
    name: 'Priya Patel',
    role: 'VP Operations, Globex Corporation',
  },
  {
    quote:
      'Their platform team rolled out our new billing integration on a compressed timeline without a single surprise. The pricing transparency alone won us over.',
    name: 'Sam Rivera',
    role: 'CEO, Initech',
  },
  {
    quote:
      'We came for the analytics and stayed for the onboarding support. Acme thinks about the whole workflow, not just the feature in front of them.',
    name: 'Morgan Diaz',
    role: 'Head of Data, Vandelay Industries',
  },
  {
    quote:
      'The data migration was meticulous. They surfaced value in records we had written off years ago.',
    name: 'Casey Nguyen',
    role: 'Founder, Stark Industries',
  },
]

export const Default: Story = {
  name: 'Customer testimonials',
  render: () => (
    <div className="mx-auto max-w-md px-12">
      <Carousel opts={{ loop: true }} className="w-full">
        <CarouselContent>
          {testimonials.map((testimonial) => (
            <CarouselItem key={testimonial.name}>
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <p className="font-serif text-lg leading-relaxed text-foreground">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                  <div>
                    <p className="text-sm font-medium text-foreground">{testimonial.name}</p>
                    <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  ),
}
