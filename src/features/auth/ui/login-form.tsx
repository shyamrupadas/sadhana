import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

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
import { useLogin } from '../model/use-login'

const loginShema = z.object({
  email: z.string().pipe(z.email('Некорректный email')),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
})

export const LoginForm = () => {
  const form = useForm({
    resolver: zodResolver(loginShema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const { login, errorMessage, isPending } = useLogin()

  const onSubmit = form.handleSubmit(login)

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
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

        {errorMessage && <p className="text-destructive text-sm">{errorMessage}</p>}

        <Button type="submit" disabled={isPending}>
          Войти
        </Button>
      </form>
    </Form>
  )
}
