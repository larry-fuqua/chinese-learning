import { NewStoryForm } from "@/components/NewStoryForm";

export default async function NewStoryPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <NewStoryForm storyId={id} />;
}
