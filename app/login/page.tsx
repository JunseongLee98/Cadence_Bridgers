import { redirect } from 'next/navigation';

/** Login screen removed — send old bookmarks to the main app. */
export default function LoginPage() {
  redirect('/');
}
