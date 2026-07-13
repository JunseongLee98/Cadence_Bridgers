import { redirect } from 'next/navigation';

/** Old OAuth homepage path — keep working; canonical public home is `/`. */
export default function HomeRedirectPage() {
  redirect('/');
}
