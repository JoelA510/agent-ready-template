import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'

function App() {
  return (
    <main className="min-h-screen bg-background p-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Acme Inc.</p>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">
            Design system smoke test
          </h1>
          <p className="mt-2 text-muted-foreground">
            This page exists to sanity-check the token pipeline and pattern components while the
            rest of the system is being built. The living documentation lives in Storybook.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>

        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Example card</CardTitle>
            <CardDescription>Confirm the details before continuing.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground">
              Background, card surface, and border tokens are all wired end-to-end here.
            </p>
          </CardContent>
          <CardFooter className="gap-2 border-t border-border pt-6">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button size="sm">Confirm</Button>
          </CardFooter>
        </Card>

        <div className="flex flex-wrap gap-1">
          <div className="size-10 rounded-md bg-brand-50 border border-border" />
          <div className="size-10 rounded-md bg-brand-100" />
          <div className="size-10 rounded-md bg-brand-200" />
          <div className="size-10 rounded-md bg-brand-300" />
          <div className="size-10 rounded-md bg-brand-400" />
          <div className="size-10 rounded-md bg-brand-500" />
          <div className="size-10 rounded-md bg-brand-600" />
          <div className="size-10 rounded-md bg-brand-700" />
          <div className="size-10 rounded-md bg-brand-800" />
          <div className="size-10 rounded-md bg-brand-900" />
          <div className="size-10 rounded-md bg-brand-950" />
          <div className="size-10 rounded-md bg-accent-500" />
          <div className="size-10 rounded-md bg-accent-100" />
        </div>
      </div>
    </main>
  )
}

export default App
