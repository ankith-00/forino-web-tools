import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { TOOLS, isAdmin, userAccess, canAccessTool, mergeToolAccess } from '@/lib/access'
import { fetchPublicTools } from '@/lib/public-tools'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const pathname = request.nextUrl.pathname

    // API routes self-authorize server-side; don't spend a getUser() on them here.
    if (pathname.startsWith('/api')) {
        return supabaseResponse
    }

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const {
        data: { user },
    } = await supabase.auth.getUser()

    // Define protected routes
    const isProtectedRoute = pathname.startsWith('/dashboard') ||
        pathname.startsWith('/manage-users') ||
        TOOLS.some((t) => pathname === t.path)

    // Define auth routes (login/register)
    const isAuthRoute = pathname === "/" ||
        pathname.startsWith('/login') ||
        pathname.startsWith('/register')

    // 1. Redirect unauthenticated users away from protected routes
    if (!user && isProtectedRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // 2. Redirect logged-in users away from login/register pages
    if (user && isAuthRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    // 3. Admin-only routes — this is an optimistic check; /manage-users also verifies server-side
    if (user && pathname.startsWith('/manage-users') && !isAdmin(user)) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    // 4. Tool routes — hide tools the user hasn't been granted. Public tools bypass
    //    grants, so they're fetched only when this exact request is a tool route.
    const toolMatch = TOOLS.find((t) => pathname === t.path)
    if (user && toolMatch && !isAdmin(user)) {
        const access = mergeToolAccess(userAccess(user), await fetchPublicTools(supabase))
        if (!canAccessTool(access, toolMatch.slug)) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}
