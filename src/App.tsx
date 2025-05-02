import { Button } from './components/ui/button'

function App() {
  return (
    <div className="container w-full flex justify-center items-center h-screen gap-4">
      <Button>test button</Button>
      <Button size="lg" variant="outline">
        test button1
      </Button>
      <Button size="lg" variant="secondary">
        test button1
      </Button>
    </div>
  )
}

export default App
