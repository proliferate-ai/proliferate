import { useSupportReportUploadQueue } from "#product/hooks/support/lifecycle/use-support-report-upload-queue"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * The single support-report upload owner, mounted only while authenticated.
 *
 * Both ends of the queue already require a live Cloud session: the modal cannot
 * open without one (`useSupportAvailability`), and every drain step is an
 * authenticated Cloud call. Mounting the owner behind that same gate is what
 * lets it be lazy-loaded, which keeps the queue, artifact-verification, and
 * upload modules off the /login first-load path (login runtime JS budget).
 */
export function SupportReportQueueRoot() {
  recordBootDiagnosticOnce("app_runtime.render.before.use_support_report_upload_queue")
  useSupportReportUploadQueue()
  recordBootDiagnosticOnce("app_runtime.render.after.use_support_report_upload_queue")
  return null
}
