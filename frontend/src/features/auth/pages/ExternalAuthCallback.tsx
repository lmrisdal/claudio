import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAuth } from "../hooks/useAuth";

export default function ExternalAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeExternalLogin } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const externalNonce = params.get("external_nonce");
    const providerName = params.get("provider");
    const authError = params.get("error");

    if (authError) {
      navigate(`/login?${new URLSearchParams({ error: authError })}`, {
        replace: true,
      });
      return;
    }

    if (!externalNonce || !providerName) {
      navigate("/login", { replace: true });
      return;
    }

    completeExternalLogin(externalNonce)
      .then(() => {
        navigate("/", { replace: true });
      })
      .catch((err) => {
        navigate(
          `/login?${new URLSearchParams({
            error:
              err instanceof Error ? err.message : `${providerName} login failed`,
          })}`,
          { replace: true },
        );
      });
  }, [completeExternalLogin, location.search, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-grid">
      <div className="w-full max-w-sm">
        <div className="card bg-surface rounded-xl p-6 ring-1 ring-border text-center">
          <p className="text-sm text-text-secondary">Completing sign-in…</p>
        </div>
      </div>
    </div>
  );
}
