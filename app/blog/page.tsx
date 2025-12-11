import { redirect } from "next/navigation";
export default function BlogPage() {
  redirect("/")
}

// import { BlogPostCard } from "@/components/blog-post-card";
// import { Footer } from "@/components/footer";
// import { getAllPosts } from "@/lib/blog";
// import Link from "next/link";
// import { redirect } from "next/navigation";

// export default async function BlogPage() {
//   const blogPosts = await getAllPosts();
//   redirect("/")
  
//   return (
//     <>
//       <main className="min-h-screen bg-black">
//         <section className="pt-24 pb-20">
//           <div className="max-w-5xl mx-auto px-8">
//             <div className="flex flex-col items-center text-center mb-20">
//               <h1 className="mb-4 text-[clamp(1.7rem,4.5vw,3.5rem)] font-bold tracking-[-0.05em] text-white leading-[1] sm:leading-[1.1]">
//                 Learnings from the Frontlines
//               </h1>
//               <p className="max-w-2xl text-lg text-white/60 leading-relaxed">
//                 Deep dives into production debugging, AI engineering, and the future of software maintenance.
//               </p>
//             </div>

//             {blogPosts.length === 0 ? (
//               <div className="text-center py-20">
//                 <p className="text-white/60">No blog posts yet. Add markdown files to /content/blog to get started.</p>
//               </div>
//             ) : (
//               <>
//                 {/* Hero card - first blog post */}
//                 {blogPosts.length > 0 && (
//                   <div className="flex gap-4 pb-12 mb-12">
//                     <div className="flex-1">
//                       <Link href={`/blog/${blogPosts[0].slug}`} className="block group">
//                         <div className="relative rounded-lg overflow-hidden bg-gradient-to-br from-neutral-900 to-black">
//                           {blogPosts[0].image ? (
//                             <img 
//                               src={blogPosts[0].image} 
//                               alt={blogPosts[0].title}
//                               className="w-full aspect-[16/9] object-cover rounded-lg"
//                             />
//                           ) : (
//                             <>
//                               <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10" />
//                               <div className="aspect-[16/9]" />
//                             </>
//                           )}
//                         </div>
//                       </Link>
//                     </div>
//                     <div className="w-96 flex items-end pb-8">
//                       <div className="flex flex-col gap-6 px-10">
//                         <h3 className="text-[clamp(1.2rem,2.5vw,1.8rem)] font-bold tracking-[-0.05em] text-white leading-[1] sm:leading-[1.1]">
//                           <Link href={`/blog/${blogPosts[0].slug}`} className="hover:text-neutral-300 transition-colors">
//                             {blogPosts[0].title}
//                           </Link>
//                         </h3>
//                         <p className="text-base text-neutral-400 leading-relaxed">
//                           {blogPosts[0].excerpt}
//                         </p>
//                         <div className="pt-2">
//                           <Link 
//                             href={`/blog/${blogPosts[0].slug}`}
//                             className="inline-flex px-6 py-2 text-sm font-medium text-white border border-white/20 rounded-full hover:bg-white/10 transition-colors uppercase tracking-wide"
//                           >
//                             Read More
//                           </Link>
//                         </div>
//                       </div>
//                     </div>
//                   </div>
//                 )}

//                 {/* Grid of smaller blog posts */}
//                 {blogPosts.length > 1 && (
//                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
//                     {blogPosts.slice(1).map((post) => (
//                       <BlogPostCard key={post.slug} post={post} />
//                     ))}
//                   </div>
//                 )}
//               </>
//             )}
//           </div>
//         </section>
//       </main>
//       <Footer />
//     </>
//   );
// }