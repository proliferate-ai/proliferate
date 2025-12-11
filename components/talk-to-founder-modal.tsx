'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendlyButton } from '@/components/calendly-button';

type TalkToFounderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TalkToFounderModal({ open, onOpenChange }: TalkToFounderModalProps) {
  const [step, setStep] = useState<'form' | 'sent'>('form');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [isInSF, setIsInSF] = useState<boolean | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setStep('form');
    setIsSubmitting(false);
    setEmail('');
    setIsInSF(null);
    setNeighborhood('');
    setWhen('');
    setNotes('');
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 250);
  };

  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/talk-to-founder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, isInSF, neighborhood, when, notes }),
      });
      if (!res.ok) throw new Error('Request failed');
      setStep('sent');
    } catch (e) {
      console.error(e);
      setStep('sent');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border border-neutral-700 bg-neutral-900 text-neutral-100 focus:border-neutral-700">
        <DialogHeader>
          <DialogTitle className="text-base">Talk to the founder</DialogTitle>
          <DialogDescription className="text-neutral-400">We&apos;ll be in touch shortly.</DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <CalendlyButton
                size="lg"
                className="w-full bg-neutral-100 text-neutral-900 hover:bg-white"
                text="Schedule a call now"
              />
              <p className="text-[11px] text-neutral-500 text-center">Prefer to talk later? Leave your email and we&apos;ll reach out.</p>
            </div>

            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <div className="h-px flex-1 bg-neutral-700" />
              or
              <div className="h-px flex-1 bg-neutral-700" />
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-400">Work email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1 bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500" />
              </div>
              <div>
                <label className="text-xs text-neutral-400">Anything else (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Team size, product, ideal time, etc."
                  className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                  rows={3}
                />
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={isInSF === true}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsInSF(checked ? true : null);
                      if (!checked) {
                        setNeighborhood('');
                        setWhen('');
                      }
                    }}
                    className="h-4 w-4 rounded border-neutral-600 bg-neutral-800"
                  />
                  In SF? Request in‑person visit
                </label>

                {isInSF === true && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-neutral-400">Neighborhood</label>
                        <Input
                          value={neighborhood}
                          onChange={(e) => setNeighborhood(e.target.value)}
                          placeholder="SOMA, Mission, Hayes, ..."
                          className="mt-1 bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-neutral-400">Rough timing</label>
                        <Input
                          value={when}
                          onChange={(e) => setWhen(e.target.value)}
                          placeholder="This week, next week, etc."
                          className="mt-1 bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={close} className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800">Close</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting || !email} className="bg-neutral-100 text-neutral-900 hover:bg-white">
                {isSubmitting ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'sent' && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-300">Thanks - we got it. We&apos;ll reach out shortly.</p>
            <CalendlyButton
              size="lg"
              className="w-full bg-neutral-100 text-neutral-900 hover:bg-white"
              text="Schedule a call now"
            />
            <Button onClick={close} className="w-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700">Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}