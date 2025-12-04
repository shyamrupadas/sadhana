import { useForm } from 'react-hook-form'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form'
import { Input } from '@/shared/components/ui/input'
import { Button } from '@/shared/components/ui/button'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const loginShema = z.object({
  email: z.string().pipe(z.email('Некорректный email')),
  password: z.string().min(6, 'Пароль должен бытьне менее 6 символов'),
})

export const LoginForm = () => {
  const form = useForm({ resolver: zodResolver(loginShema) })

  const onSbmit = form.handleSubmit((data) => {
    console.log(data)
  })

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4" onSubmit={onSbmit}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="user@domain.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Пароль</FormLabel>
              <FormControl>
                <Input placeholder="******" type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit">Войти</Button>
      </form>
    </Form>
  )
}
