// pages/join/[code].js
// The link in a scanner invite (opti-menu.com/join/482913). Sends them to the
// code screen with the code already filled in. That screen lives under
// /client so the phone app keeps it inside the app.
export async function getServerSideProps({ params }) {
  const code = String(params?.code || "").replace(/\D/g, "").slice(0, 6);
  return { redirect: { destination: code ? `/client/join?code=${code}` : "/client/join", permanent: false } };
}

export default function JoinRedirect() {
  return null;
}