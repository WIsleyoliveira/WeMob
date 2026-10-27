import { StateMessage } from "./state";

export function EmptyState({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return <StateMessage kind="empty" title={title} description={description} action={action} />;
}
