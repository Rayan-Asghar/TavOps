/* The login route has its own bare layout with no sidebar, so the root
   LoadingShell would flash an app frame at someone who is not signed in yet.
   The form is two fields and renders fast; 4.6 r42 says show nothing. */
export default function Loading() {
  return null;
}
