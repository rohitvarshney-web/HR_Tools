import React, { useEffect } from "react";

const Login = () => {
  useEffect(() => {
    // If token exists in URL, store it and redirect
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      localStorage.setItem("token", token);
      window.location.href = "/"; // go to dashboard/home
    }
  }, []);

  const handleLogin = () => {
    // Redirect to backend’s Google OAuth
    window.location.href = `${import.meta.env.VITE_BACKEND_URL}/auth/google`;
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="p-8 bg-white shadow-md rounded-lg text-center">
        <h1 className="text-2xl font-bold mb-6">HR Recruitment Login</h1>
        <button
          onClick={handleLogin}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
};

export default Login;
