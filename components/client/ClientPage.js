// components/client/ClientPage.js
// Shared frame for the client pages that sit outside the five main tabs
// (Recipes & prep, Inventory count, Notifications). Desktop: the normal
// header with search, bell and account menu over the grey page. Phones:
// a back bar when the page opens from somewhere else, else the phone
// header, then the bottom nav, matching every other phone screen.
import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import supabase from "../../lib/supabaseClient";
import UniversalSearch from "../UniversalSearch";
import {
  Shell,
  Header,
  MobileHeader,
  MobileNav,
  MobileBackBar,
  FONT_LINKS,
  MONO,
  useTheme,
  useIsMobile,
} from "./ClientChrome";

const NavLink = ({ href, style, className, children }) => (
  <Link href={href} style={style} className={className}>{children}</Link>
);

export default function ClientPage({
  title,
  account,
  active = null,
  back = null,
  phoneBack = null,
  maxWidth = 1180,
  children,
}) {
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const isMobile = useIsMobile();
  const [searchOpen, setSearchOpen] = useState(false);

  const fullName = account?.profile?.full_name || "";
  const user = {
    initials: fullName.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "•",
    firstName: fullName.split(" ")[0] || "",
  };
  const restaurantName = account?.restaurant?.name || "";

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/client/login");
  };

  const head = (
    <Head>
      <title>{`${title} · OptiMenu`}</title>
      {FONT_LINKS}
    </Head>
  );

  if (isMobile) {
    return (
      <Shell theme={theme} style={{ position: "fixed", inset: 0, height: "auto", minHeight: 0, overflow: "hidden" }}>
        {head}
        {phoneBack ? (
          <MobileBackBar
            label={phoneBack.label}
            title={phoneBack.title || ""}
            onBack={() => (phoneBack.onBack ? phoneBack.onBack() : router.push(phoneBack.href))}
            right={phoneBack.right}
          />
        ) : (
          <MobileHeader
            theme={theme}
            onToggleTheme={toggleTheme}
            onSearch={() => setSearchOpen(true)}
            onSignOut={signOut}
            restaurantName={restaurantName}
            NavLink={NavLink}
            user={user}
          />
        )}
        <div className="om-mscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", background: "var(--panel)" }}>
          <div style={{ padding: "18px 16px 32px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {children}
          </div>
        </div>
        <MobileNav active={active} NavLink={NavLink} />
        <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      </Shell>
    );
  }

  return (
    <Shell theme={theme}>
      {head}
      <Header
        active={active}
        NavLink={NavLink}
        user={user}
        restaurantName={restaurantName}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSearch={() => setSearchOpen(true)}
        onSignOut={signOut}
      />
      <main style={{ flex: 1, background: "var(--panel)" }}>
        <div style={{ width: "100%", maxWidth, boxSizing: "border-box", margin: "0 auto", padding: "24px 32px 64px", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {back && (
            <Link href={back.href} style={{ display: "inline-flex", alignItems: "center", gap: 2, alignSelf: "flex-start", fontSize: 13, fontWeight: 700, color: "var(--accent-deep)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              {back.label}
            </Link>
          )}
          {children}
        </div>
      </main>
      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Shell>
  );
}

// Page title block: mono kicker, large title, optional line under it and
// optional actions on the right. Same sizes as the admin and phone titles.
export function PageTitle({ kicker, title, sub, isPhone = false, children }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        {kicker && (
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)" }}>{kicker}</div>
        )}
        <h1 style={{ margin: "6px 0 0", fontSize: isPhone ? 25 : 26, fontWeight: 800, letterSpacing: isPhone ? "-0.04em" : "-0.03em", lineHeight: 1.1 }}>{title}</h1>
        {sub && <p style={{ margin: "6px 0 0", fontSize: isPhone ? 13.5 : 14, lineHeight: 1.5, color: "var(--muted)", maxWidth: 720 }}>{sub}</p>}
      </div>
      {children && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>{children}</div>}
    </div>
  );
}