/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPostBySlug, getAllPosts } from "@/lib/blog";
import { SiteHeader } from "@/components/header";
import { Footer } from "@/components/footer";
import { WaitlistForm } from "@/components/waitlist-form";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Metadata } from "next";

// Markdown components styled like Resend's blog
const components: any = {
  h1: ({ children }: any) => (
    <h1 className="group relative mb-2 mt-14 scroll-mt-20 font-semibold text-white text-3xl">
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="group relative mb-2 mt-12 scroll-mt-20 font-semibold text-white text-2xl">
      {children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="group relative mb-2 mt-10 scroll-mt-20 font-semibold text-white text-xl">
      {children}
    </h3>
  ),
  p: ({ children }: any) => (
    <p className="leading-7 text-neutral-400 my-5 text-pretty">{children}</p>
  ),
  ul: ({ children }: any) => (
    <ul className="my-5 ml-6 list-disc space-y-2 text-neutral-400 marker:text-neutral-600">
      {children}
    </ul>
  ),
  ol: ({ children }: any) => (
    <ol className="my-5 ml-6 list-decimal space-y-2 text-neutral-400 marker:text-neutral-500">
      {children}
    </ol>
  ),
  li: ({ children }: any) => <li className="leading-7 pl-1">{children}</li>,
  strong: ({ children }: any) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  a: ({ href, children }: any) => (
    <a
      href={href}
      className="border-b border-neutral-500 font-medium text-neutral-300 transition-colors duration-200 ease-in-out hover:text-white hover:border-white"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-neutral-700 pl-6 my-6 text-neutral-500 italic">
      {children}
    </blockquote>
  ),
  code: ({ inline, children }: any) => {
    return inline ? (
      <code className="bg-white/10 px-1.5 py-0.5 rounded text-neutral-300 text-sm font-mono">
        {children}
      </code>
    ) : (
      <pre className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 my-6 overflow-x-auto">
        <code className="text-neutral-300 text-sm font-mono">{children}</code>
      </pre>
    );
  },
  hr: () => <hr className="my-10 border-t border-neutral-800" />,
};

export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    return {
      title: "Post Not Found | Proliferate",
    };
  }

  return {
    title: `${post.title} | Proliferate`,
    description: post.excerpt,
  };
}

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const formattedDate = new Date(post.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-black">
      <SiteHeader />

      <main className="pt-8 pb-20">
        <article className="mx-auto flex flex-col px-6">
          {/* Header */}
          <header className="mx-auto max-w-2xl flex flex-col items-center text-center mb-10">
            <span className="text-sm text-neutral-500 mb-4">{formattedDate}</span>

            <h1 className="text-[clamp(2rem,5vw,3rem)] font-bold tracking-[-0.03em] text-white leading-[1.15] mb-6 text-balance">
              {post.title}
            </h1>

            <div className="flex items-center gap-2 text-neutral-500">
              <span className="text-sm font-medium text-neutral-400">
                {post.author}
              </span>
              <span>·</span>
              <span className="text-sm">{post.readTime}</span>
            </div>
          </header>

          {/* Featured Image */}
          {post.image && (
            <div className="mx-auto w-full max-w-4xl mb-12">
              <div className="relative aspect-video rounded-xl overflow-hidden border border-neutral-800">
                <Image
                  src={post.image}
                  alt={post.title}
                  fill
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          )}

          {/* Content */}
          <div className="content mx-auto max-w-2xl">
            <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
              {post.content || ""}
            </ReactMarkdown>
          </div>

          {/* Divider and CTA */}
          <div className="pt-16 mx-auto max-w-2xl">
            <div className="relative rounded-3xl border-t border-neutral-800 mx-auto flex flex-col items-center px-12 pt-10">
              {/* Gradient line effect */}
              <div
                aria-hidden="true"
                className="left-1/2 top-0 w-[400px] center pointer-events-none absolute h-px max-w-full -translate-x-1/2 -translate-y-1/2"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, rgba(255, 255, 255, 0) 0%, rgba(143, 143, 143, 0.67) 50%, rgba(0, 0, 0, 0) 100%)",
                }}
              />

              <p className="text-neutral-400 mb-6 text-center">
                Ready to stop debugging and start shipping?
              </p>

              <WaitlistForm>
                <button className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-xl bg-white text-black hover:bg-neutral-100 transition-colors">
                  Join early access
                </button>
              </WaitlistForm>
            </div>
          </div>

          {/* Back to blog */}
          <div className="mx-auto max-w-2xl mt-16">
            <Link
              href="/blog"
              className="text-sm text-neutral-500 hover:text-white transition-colors"
            >
              ← Back to blog
            </Link>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
