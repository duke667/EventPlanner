import { GuestExperience } from "./guest-experience";

export const dynamic = "force-dynamic";

export default function GuestPage({
  params,
}: {
  params: { token: string };
}) {
  return <GuestExperience token={params.token} />;
}
