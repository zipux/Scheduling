import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import type { ReactElement } from "react";

function Layout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ fontFamily: "system-ui, sans-serif", backgroundColor: "#f6f6f6", padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#fff", borderRadius: 8, padding: 24, maxWidth: 480 }}>{children}</Container>
      </Body>
    </Html>
  );
}

const button = {
  backgroundColor: "#111",
  color: "#fff",
  borderRadius: 6,
  padding: "12px 20px",
  textDecoration: "none",
  fontWeight: 600,
};

async function out(subject: string, el: ReactElement) {
  return { subject, html: await render(el), text: await render(el, { plainText: true }) };
}

export function magicLinkEmail({ url }: { url: string }) {
  return out(
    "Your sign-in link",
    <Layout preview="Your sign-in link">
      <Heading as="h2">Sign in</Heading>
      <Text>Use the button below to sign in. The link expires in 15 minutes and can be used once.</Text>
      <Section>
        <Button href={url} style={button}>
          Sign in
        </Button>
      </Section>
      <Text style={{ color: "#666", fontSize: 12 }}>If you didn’t ask for this, you can ignore this email.</Text>
    </Layout>,
  );
}

export function invitationEmail(p: { url: string; businessName: string; inviterName: string | null; roleName: string }) {
  return out(
    `You're invited to join ${p.businessName}`,
    <Layout preview={`Join ${p.businessName}`}>
      <Heading as="h2">Join {p.businessName}</Heading>
      <Text>
        {p.inviterName ? `${p.inviterName} invited you` : "You've been invited"} to join {p.businessName} as {p.roleName}.
      </Text>
      <Section>
        <Button href={p.url} style={button}>
          Accept invitation
        </Button>
      </Section>
      <Text style={{ color: "#666", fontSize: 12 }}>This link expires in 7 days and can be used once.</Text>
    </Layout>,
  );
}

export function notificationEmail(p: { title: string; body: string; url: string }) {
  return out(
    p.title,
    <Layout preview={p.title}>
      <Heading as="h2">{p.title}</Heading>
      <Text>{p.body}</Text>
      <Section>
        <Button href={p.url} style={button}>
          Open my schedule
        </Button>
      </Section>
    </Layout>,
  );
}
