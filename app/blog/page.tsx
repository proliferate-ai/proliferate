import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/header";
import { Footer } from "@/components/footer";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog | Proliferate",
  description: "Latest news, guides, and insights from the Proliferate team.",
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BlogPage() {
  const posts = await getAllPosts();

  return (
    <div className="min-h-screen bg-black">
      <SiteHeader />

      {/* Main Content */}
      <main className="mx-auto w-full max-w-5xl px-6 md:max-w-7xl">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 py-16">
          {/* Header */}
          <div className="w-full flex flex-col items-center justify-between mb-8 mt-2 gap-3 md:flex-row md:gap-0">
            <h1 className="text-5xl md:text-6xl font-bold tracking-[-0.03em] bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-transparent pb-2">
              Blog
            </h1>
          </div>

          {/* Blog Posts Grid */}
          {posts.length > 0 ? (
            <ul className="relative grid h-max gap-8 md:grid-cols-2 items-stretch mt-8">
              {posts.map((post) => (
                <li key={post.slug} className="relative flex w-auto flex-col gap-2 group">
                  <Link href={`/blog/${post.slug}`} className="block">
                    {/* Image */}
                    <div className="relative col-span-2 w-full overflow-hidden border border-white/10 rounded-xl aspect-video bg-gradient-to-br from-neutral-900 to-neutral-800 flex items-center justify-center">
                      {post.image ? (
                        <Image
                          src={post.image}
                          alt={post.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-neutral-600">
                          <Image
                            src="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp"
                            alt="Proliferate"
                            width={48}
                            height={48}
                            className="opacity-30"
                          />
                        </div>
                      )}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-[-0.02em] text-white mt-4 line-clamp-2 leading-tight group-hover:text-neutral-200 transition-colors">
                      {post.title}
                    </h2>
                  </Link>
                  <p className="text-neutral-500 line-clamp-2 mt-1 text-pretty leading-relaxed">
                    {post.excerpt}
                  </p>
                  <div className="mt-2 flex items-center justify-start gap-2 text-neutral-500">
                    <span className="text-sm">{post.author}</span>
                    <span>·</span>
                    <time dateTime={post.date} className="text-sm">
                      {formatDate(post.date)}
                    </time>
                    <span>·</span>
                    <span className="text-sm">{post.readTime}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-neutral-500">
              <p className="text-lg">No posts yet. Check back soon!</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
