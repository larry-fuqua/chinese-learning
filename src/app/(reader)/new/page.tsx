import { NewStoryForm } from "@/components/NewStoryForm";

export default async function NewStoryPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; book?: string }>;
}) {
  const { id, book } = await searchParams;
  return <NewStoryForm storyId={id} bookId={book} />;
}
