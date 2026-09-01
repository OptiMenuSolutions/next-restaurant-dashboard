import Head from "next/head";
import Link from "next/link";
import supabase from "../../lib/supabaseClient";
import AuthScreen from "../../components/client/AuthScreen";

/**
 * pages/client/signup.js — data container.
 *
 * The real schema has `create_restaurant_trigger` (AFTER INSERT ON profiles,
 * calling create_restaurant_for_profile()) — inserting a profiles row is
 * what auto-creates the restaurants row, not the other way around. So this
 * file's job is: create the auth user, then insert the profiles row.
 *
 * Real limitation, not a guess: if email confirmation is required,
 * supabase.auth.signUp() returns no active session, and this insert (which
 * needs `auth.uid() = id` per RLS) will fail silently — there's no session
 * to authenticate it yet. login.js has a matching fallback that creates the
 * profile on first successful sign-in instead, so either path ends up with
 * a profile (and therefore a restaurant, via the trigger) — but if this
 * insert fails here, don't treat that as a bug; it's expected when
 * confirmation is on, and login.js is where it actually lands in that case.
 */
export default function SignupPage() {
  const handleSubmit = async ({ fullName, email, password }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;

    if (data?.session && data?.user) {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        email: data.user.email,
        full_name: fullName,
      });
      if (profileError) {
        console.error("[signup] profile creation deferred to first login:", profileError.message);
      }
    }
    // AuthScreen shows its own "check your email to confirm" state on
    // success; no redirect needed here.
  };

  return (
    <>
      <Head>
        <title>Create your account — OptiMenu</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <AuthScreen mode="signup" onSubmit={handleSubmit} NavLink={Link} />
    </>
  );
}
