"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

// This page now redirects to the contact page with the postcard tab open.
// All postcard management happens on the unified contact page.
export default function PostcardDetailRedirect() {
  const params = useParams();
  const router = useRouter();
  const postcardId = params.id as string;
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/postcards/${postcardId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.postcard?.contactId) {
          router.replace(`/dashboard/contacts/${data.postcard.contactId}?tab=postcard`);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, [postcardId, router]);

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Postcard not found.</p>
        <button
          onClick={() => router.push("/dashboard/postcards")}
          className="text-primary hover:text-primary-hover mt-4 text-sm"
        >
          Back to Postcards
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
