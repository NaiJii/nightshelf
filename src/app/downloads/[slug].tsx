import { Redirect, useLocalSearchParams } from "expo-router";

export default function SavedChapters() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: "/series/[slug]", params: { slug, filter: "downloaded" } }} />;
}
