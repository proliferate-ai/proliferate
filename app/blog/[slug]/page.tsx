import { redirect } from "next/navigation"; 

export default function BlogPost() {
  redirect("/")
}

// /* eslint-disable @typescript-eslint/no-explicit-any */
// import { getPostBySlug, getAllPosts } from "@/lib/blog";
// import { Footer } from "@/components/footer";
// import Link from "next/link";
// import { notFound, redirect } from "next/navigation";
// import ReactMarkdown from 'react-markdown';
// import remarkGfm from 'remark-gfm';

// const components: any = {
//   h1: ({ children }: any) => (
//     <h1 className="text-3xl font-bold mt-16 mb-8 text-white">
//       {children}
//     </h1>
//   ),
//   h2: ({ children }: any) => (
//     <h2 className="text-2xl font-bold mt-14 mb-6 text-white">
//       {children}
//     </h2>
//   ),
//   h3: ({ children }: any) => (
//     <h3 className="text-xl font-bold mt-10 mb-4 text-white">
//       {children}
//     </h3>
//   ),
//   p: ({ children }: any) => (
//     <p className="mb-8 leading-[1.9] font-normal text-neutral-200">
//       {children}
//     </p>
//   ),
//   ul: ({ children }: any) => (
//     <ul className="my-8 ml-6 list-disc space-y-3 text-neutral-200">
//       {children}
//     </ul>
//   ),
//   ol: ({ children }: any) => (
//     <ol className="my-8 ml-6 list-decimal space-y-3 text-neutral-200">
//       {children}
//     </ol>
//   ),
//   li: ({ children }: any) => (
//     <li className="leading-[1.9]">
//       {children}
//     </li>
//   ),
//   strong: ({ children }: any) => (
//     <strong className="font-semibold text-white">
//       {children}
//     </strong>
//   ),
//   a: ({ href, children }: any) => (
//     <a
//       href={href}
//       className="text-white underline underline-offset-4 hover:text-gray-300"
//       target="_blank"
//       rel="noopener noreferrer"
//     >
//       {children}
//     </a>
//   ),
//   blockquote: ({ children }: any) => (
//     <blockquote className="border-l-4 border-white/30 pl-6 my-10 text-white/70 italic">
//       {children}
//     </blockquote>
//   ),
//   code: ({ inline, children }: any) => {
//     return inline ? (
//       <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/90 text-sm">
//         {children}
//       </code>
//     ) : (
//       <pre className="bg-white/5 border border-white/10 rounded-lg p-4 my-8 overflow-x-auto">
//         <code className="text-white/90 text-sm">
//           {children}
//         </code>
//       </pre>
//     )
//   },
//   hr: () => (
//     <hr className="my-12 border-t border-white/20" />
//   ),
// };

// export async function generateStaticParams() {
//   const posts = await getAllPosts();
//   return posts.map((post) => ({
//     slug: post.slug,
//   }));
// }

// export default async function BlogPost({
//   params,
// }: {
//   params: Promise<{ slug: string }>;
// }) {
//   const { slug } = await params;
//   const post = await getPostBySlug(slug);


//   redirect("/")
//   if (!post) {
//     notFound();
//   }

//   return (
//     <>
//       <main className="min-h-screen bg-black">
//         <article className="pt-12 pb-20">
//           <div className="mx-auto flex flex-col px-8">
//             <div className=" flex flex-col items-center">

//               <header className="flex flex-col items-center">
//                 <span className="text-sm text-white/50 mb-4">
//                   {new Date(post.date).toLocaleDateString('en-US', {
//                     year: 'numeric',
//                     month: 'long',
//                     day: 'numeric'
//                   })}
//                 </span>

//                 <h1 className="text-center text-[clamp(2.5rem,5vw,3.5rem)] font-bold tracking-[-0.03em] text-white leading-[1.1] mb-8">
//                   {post.title}
//                 </h1>

//                 {post.image && (
//                   <div className="w-full max-w-4xl mb-12">
//                     <img
//                       src={post.image}
//                       alt={post.title}
//                       className="w-full rounded-lg"
//                     />
//                   </div>
//                 )}
//               </header>
//             </div>


//             <div className="mx-auto text-base max-w-2xl">
//               <ReactMarkdown
//                 components={components}
//                 remarkPlugins={[remarkGfm]}
//               >
//                 {post.content || ''}
//               </ReactMarkdown>
//             </div>

//             {/* CTA Section */}
//             <div className="mt-20 mx-auto max-w-2xl border-t border-white/10 pt-12">
//               <div className="text-center">
//                 <p className="text-white/60 mb-6">
//                   Ready to stop debugging and start shipping?
//                 </p>
//                 <Link
//                   href="/#waitlist"
//                   className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg bg-white text-black hover:bg-gray-100 transition-colors"
//                 >
//                   Join early access →
//                 </Link>
//               </div>
//             </div>
//           </div>
//         </article>
//       </main>
//       <Footer />
//     </>
//   );
// }