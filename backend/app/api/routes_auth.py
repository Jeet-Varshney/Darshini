"""
Darshini - Authentication and User Administration Routes
Provides login, one-time bootstrap setup, profile inspection, and user management endpoints.
"""

from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.auth import (
    ROLE_ADMIN,
    ROLE_CHECKIN_OPERATOR,
    ROLE_EVENT_MANAGER,
    check_auth_rate_limit,
    clear_auth_rate_limit,
    create_access_token,
    get_current_user,
    require_role,
)
from app.schemas_events import (
    CreateUserRequest,
    LoginRequest,
    LoginResponse,
    SetupAdminRequest,
    UserProfile,
)
from app.services.user_service import UserService

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & Access Control"])


@router.post(
    "/setup-admin",
    response_model=LoginResponse,
    summary="One-Time Admin Bootstrap",
    description="Initializes the first system administrator using a single-use bootstrap token.",
)
async def setup_admin(req: SetupAdminRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    check_auth_rate_limit(client_ip)

    if UserService.get_user_count() > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System is already initialized. Administrator accounts already exist.",
        )

    valid_token = UserService.verify_and_consume_bootstrap_token(req.bootstrap_token)
    if not valid_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired bootstrap setup token.",
        )

    try:
        user = UserService.create_user(
            username=req.username,
            password=req.password,
            full_name=req.full_name,
            role=ROLE_ADMIN,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    clear_auth_rate_limit(client_ip)
    access_token = create_access_token(user["id"], user["username"], user["role"])

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user,
    }


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Staff & Management Login",
    description="Authenticates staff credentials and returns an expiring JWT access token.",
)
async def login(req: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    check_auth_rate_limit(client_ip)

    user = UserService.authenticate_user(req.username, req.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    clear_auth_rate_limit(client_ip)
    access_token = create_access_token(user["id"], user["username"], user["role"])

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user,
    }


@router.get(
    "/me",
    response_model=UserProfile,
    summary="Current User Profile",
    description="Returns profile and active role of the authenticated user.",
)
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return current_user


@router.get(
    "/users",
    response_model=List[UserProfile],
    summary="List Users (Admin Only)",
    description="Lists all staff and management accounts.",
)
async def list_users(admin_user: Dict[str, Any] = Depends(require_role(ROLE_ADMIN))):
    return UserService.list_users()


@router.post(
    "/users",
    response_model=UserProfile,
    status_code=status.HTTP_201_CREATED,
    summary="Create Staff User (Admin Only)",
    description="Creates a new staff or management account with an assigned role.",
)
async def create_user(
    req: CreateUserRequest,
    admin_user: Dict[str, Any] = Depends(require_role(ROLE_ADMIN)),
):
    try:
        user = UserService.create_user(
            username=req.username,
            password=req.password,
            full_name=req.full_name,
            role=req.role,
        )
        return user
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
