import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

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
import { Label } from '@/shared/components/ui/label'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useRegister } from '../model/use-register'

const registerShema = z
  .object({
    email: z.string().pipe(z.email('Некорректный email')),
    password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
    confirmPassword: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Пароли не совпадают',
  })

export const RegisterForm = () => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const form = useForm({
    resolver: zodResolver(registerShema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const { register, errorMessage, isPending } = useRegister()

  const onSubmit = form.handleSubmit(register)

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
                <Input
                  placeholder="******"
                  type={isPasswordVisible ? 'text' : 'password'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Подтвердите пароль</FormLabel>
              <FormControl>
                <Input type={isPasswordVisible ? 'text' : 'password'} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-2">
          <Checkbox
            id="register-show-password"
            checked={isPasswordVisible}
            onCheckedChange={(checked) => setIsPasswordVisible(checked === true)}
          />
          <Label htmlFor="register-show-password">Показать пароль</Label>
        </div>

        {errorMessage && <p className="text-destructive text-sm">{errorMessage}</p>}

        <Button type="submit" disabled={isPending}>
          Зарегистрироваться
        </Button>
      </form>
    </Form>
  )
}
