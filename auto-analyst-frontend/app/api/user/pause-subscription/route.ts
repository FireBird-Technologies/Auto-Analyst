import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Pause functionality not implemented yet' },
    { status: 501 } // Not Implemented
  )
}



