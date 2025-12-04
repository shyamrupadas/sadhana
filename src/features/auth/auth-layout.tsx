import { ReactNode } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'

export const AuthLayout = ({
  form,
  title,
  description,
  footer,
}: {
  form: ReactNode
  title: ReactNode
  description: ReactNode
  footer: ReactNode
}) => {
  return (
    <main className="grow pt-50 flex flex-col items-center">
      <Card className="w-full max-w-100">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardContent>{form}</CardContent>

        <CardFooter>{footer} </CardFooter>
      </Card>
    </main>
  )
}
