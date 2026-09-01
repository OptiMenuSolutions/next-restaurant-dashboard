import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
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
 * With email confirmation OFF (the intended setup — see chat), signUp()
 * returns an active session immediately, and this now redirects straight to
 * checkout, matching the real intended flow: signup -> checkout ->
 * checkout-success -> onboarding -> dashboard.
 *
 * With email confirmation ON, signUp() returns no session, this insert
 * (which needs `auth.uid() = id` per RLS) fails silently since there's no
 * session to authenticate it yet, and AuthScreen falls back to its own
 * "check your email" state — login.js has a matching fallback that creates
 * the profile on first successful sign-in in that case.
 */
export default function SignupPage() {
  const router = useRouter();

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
        console.error("[signup] profile creation failed:", profileError.message);
      }
      router.push("/client/checkout");
      return;
    }
    // No session — email confirmation is still on. AuthScreen shows its own
    // "check your email to confirm" state on success; no redirect here.
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
