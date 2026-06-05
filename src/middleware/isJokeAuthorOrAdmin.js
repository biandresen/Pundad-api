import CustomError from "../utils/CustomError.js";
import { ROLES } from "../constants.js";
import jokeService from "../services/jokeService.js";

async function isAuthorOrAdmin(req, res, next) {
  const userId = Number(req.user?.id);
  const role = req.user?.role;
  const jokeId = Number(req.params?.id);
  const language = req.language;

  if (isNaN(jokeId)) {
    return next(new CustomError(400, "Invalid joke id given"));
  }

  const joke = await jokeService.getJokeById(jokeId, { language, requesterId: userId, requesterRole: role });
  if (!joke) {
    return next(new CustomError(404, `No joke found with id ${jokeId}`));
  }

  if (role === ROLES.ADMIN_ROLE || joke.authorId === userId) {
    return next();
  }

  return next(
    new CustomError(
      403,
      "Forbidden: Only admins or joke author are allowed to perform this action"
    )
  );
}

export default isAuthorOrAdmin;